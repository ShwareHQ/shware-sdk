import type { ConditionIR, PropertyOperatorIR, ScalarIR } from '../ir';
import type { FactSource } from './ports';
import { RECIPIENT_PROPERTY } from './recipient';

/**
 * Evaluation options.
 * - anchorMs: the earliest instant `performed` counts events from — the goal
 *   guard anchors at workflow entry (a conversion must happen *after* entry),
 *   waitUntil at the moment the wait began (a wake must not be satisfied by
 *   pre-existing history). Combined with `within` by taking the later bound.
 * - untilMs: the latest instant `performed` counts events up to — the goal's
 *   attribution window ends there, so an event after it is no conversion even
 *   when the check runs later (a resumed instance, a delayed wake).
 */
export interface EvaluateOptions {
  anchorMs?: number;
  untilMs?: number;
}

/**
 * ConditionIR evaluation: pure logic, with facts injected through FactSource,
 * so the store-backed implementation and the in-memory test one share a single set of
 * semantics and cannot drift into two evaluators.
 */
export async function evaluateCondition(
  condition: ConditionIR,
  facts: FactSource,
  nowMs: number,
  opts?: EvaluateOptions
): Promise<boolean> {
  return evaluate(condition, facts, nowMs, opts, []);
}

/**
 * `enclosing` is the chain of segment names currently being expanded. A
 * segment that reaches itself has no truth value to converge on, and left
 * unchecked the recursion runs until memory gives out, one store round trip per
 * level — inside a step, so Workflows retries it and the instance never gets
 * out. Failing immediately keeps it bounded, and the message names the cycle
 * because only a deployed bundle can fix it. Only the *path* is tracked, so a
 * diamond (two branches referencing one segment) still evaluates twice.
 */
async function evaluate(
  condition: ConditionIR,
  facts: FactSource,
  nowMs: number,
  opts: EvaluateOptions | undefined,
  enclosing: readonly string[]
): Promise<boolean> {
  switch (condition.type) {
    case 'and': {
      for (const child of condition.conditions) {
        if (!(await evaluate(child, facts, nowMs, opts, enclosing))) return false;
      }
      return true;
    }
    case 'or': {
      for (const child of condition.conditions) {
        if (await evaluate(child, facts, nowMs, opts, enclosing)) return true;
      }
      return false;
    }
    case 'not':
      return !(await evaluate(condition.condition, facts, nowMs, opts, enclosing));
    case 'segment': {
      if (enclosing.includes(condition.segment)) {
        throw new Error(
          `segment '${condition.segment}' references itself: ${[...enclosing, condition.segment].join(' -> ')}`
        );
      }
      const def = await facts.getSegmentCondition(condition.segment);
      if (def === undefined) {
        throw new Error(`Unknown segment: '${condition.segment}' (bundle not deployed?)`);
      }
      return evaluate(def, facts, nowMs, opts, [...enclosing, condition.segment]);
    }
    case 'performed': {
      const bounds: number[] = [];
      if (condition.within !== undefined) bounds.push(nowMs - condition.within.ms);
      if (opts?.anchorMs !== undefined) bounds.push(opts.anchorMs);
      const sinceMs = bounds.length > 0 ? Math.max(...bounds) : undefined;
      const atLeast = condition.count ?? 1;
      const count = await facts.countEvents(condition.event, {
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(opts?.untilMs !== undefined ? { untilMs: opts.untilMs } : {}),
        ...(condition.where !== undefined ? { where: condition.where } : {}),
        atLeast,
      });
      return count >= atLeast;
    }
    case 'property': {
      const actual = await facts.getProperty(condition.path);
      return compareProperty(condition, actual);
    }
    case 'reachable': {
      if (await facts.isSuppressed?.(condition.channel)) return false;
      if (condition.channel === 'push') return (await facts.listDevices()).length > 0;
      const path = RECIPIENT_PROPERTY[condition.channel];
      // in_app, slack and discord need no address: a signed-in user is reachable in the app, and
      // the webhook channels post to a team channel, not to the user
      return path === undefined || (await facts.getProperty(path)) !== undefined;
    }
    case 'payload':
      // Placement is validated at compile; reaching here means hand-built IR
      throw new Error(
        'payload conditions are only valid inside performed({ where }) or a trigger where clause'
      );
  }
}

/**
 * Evaluate a where tree against one event's payload. Shared by performed
 * counting (FactSource implementations) and the ingest router's trigger gate.
 * Dotted paths descend nested objects; a missing or non-scalar leaf behaves
 * like a missing property (exists sees objects, comparisons do not).
 */
export function matchesWhere(payload: unknown, where: ConditionIR): boolean {
  switch (where.type) {
    case 'and':
      return where.conditions.every((child) => matchesWhere(payload, child));
    case 'or':
      return where.conditions.some((child) => matchesWhere(payload, child));
    case 'not':
      return !matchesWhere(payload, where.condition);
    case 'payload': {
      const raw = valueAtPath(payload, where.path);
      if (where.op === 'exists') return raw !== undefined && raw !== null;
      if (where.op === 'not_exists') return raw === undefined || raw === null;
      const actual =
        typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
          ? raw
          : undefined;
      return compareProperty(where, actual);
    }
    default:
      // compileBundle rejects these; defend against hand-built IR
      throw new Error(`where clause may not contain a '${where.type}' condition`);
  }
}

function valueAtPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function compareProperty(
  condition: {
    op: PropertyOperatorIR;
    value?: ScalarIR | undefined;
    values?: ScalarIR[] | undefined;
  },
  actual: ScalarIR | undefined
): boolean {
  const { op, value, values } = condition;
  switch (op) {
    case 'exists':
      return actual !== undefined;
    case 'not_exists':
      return actual === undefined;
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'gt':
      return actual !== undefined && value !== undefined && actual > value;
    case 'gte':
      return actual !== undefined && value !== undefined && actual >= value;
    case 'lt':
      return actual !== undefined && value !== undefined && actual < value;
    case 'lte':
      return actual !== undefined && value !== undefined && actual <= value;
    case 'between':
      return isBetween(actual, values);
    case 'not_between':
      // A missing property is outside any range, mirroring not_in_array.
      return !isBetween(actual, values);
    case 'in_array':
      return actual !== undefined && (values ?? []).includes(actual);
    case 'not_in_array':
      return actual === undefined || !(values ?? []).includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && actual.includes(value);
    case 'not_contains':
      return !(typeof actual === 'string' && typeof value === 'string' && actual.includes(value));
  }
}

function isBetween(actual: ScalarIR | undefined, values: ScalarIR[] | undefined): boolean {
  if (actual === undefined || values === undefined || values.length < 2) return false;
  const [min, max] = values;
  return actual >= min && actual <= max;
}

/**
 * Wake-up channel for profile changes: a property predicate has no event name
 * of its own, so subscriptions use this reserved name and the ingest router
 * fires it on every /identify. The '$' prefix marks internal names — real
 * events may never use it (the router rejects them).
 */
export const PROFILE_UPDATED_EVENT = '$profile_updated';

/**
 * The wake-up channel for one profile property: `$profile_updated:<path>`. A property predicate
 * subscribes to its own property's channel, and `/identify` fires one per property it patched —
 * so an identify that touches `plan` does not wake a wait on `email`.
 */
export function profileUpdatedEvent(path: string): string {
  return `${PROFILE_UPDATED_EVENT}:${path}`;
}

/**
 * Wake-up channel for device changes: a device registered for the user, moved to another account
 * or was unbound or removed (`POST /devices`, `/devices/unbind`, `/devices/remove`). `reachable('push')` subscribes to it.
 */
export const DEVICES_UPDATED_EVENT = '$devices_updated';

/**
 * The set of event names a condition cares about — what wait_until subscribes
 * to for wake-ups. `performed` contributes its event; a property predicate
 * contributes its property's channel (`profileUpdatedEvent(path)`, so an
 * /identify touching that property wakes the wait and one touching another
 * does not); `reachable` contributes the recipient property's channel, or the
 * device channel for push (in_app, slack and discord have no address to wait
 * on). Segment references are expanded, which is why a FactSource is needed to
 * resolve their definitions.
 */
export async function relevantEvents(condition: ConditionIR, facts: FactSource): Promise<string[]> {
  const found = new Set<string>();
  // Names already expanded. The result is a union, so re-walking a segment can
  // only add what is already there — and a segment that reaches itself would
  // otherwise recurse until the stack blows, taking a store read per level.
  const expanded = new Set<string>();
  async function walk(c: ConditionIR): Promise<void> {
    switch (c.type) {
      case 'and':
      case 'or':
        for (const child of c.conditions) await walk(child);
        break;
      case 'not':
        await walk(c.condition);
        break;
      case 'performed':
        found.add(c.event);
        break;
      case 'segment': {
        if (expanded.has(c.segment)) break;
        expanded.add(c.segment);
        const def = await facts.getSegmentCondition(c.segment);
        if (def) await walk(def);
        break;
      }
      case 'property':
        found.add(profileUpdatedEvent(c.path));
        break;
      case 'reachable': {
        if (c.channel === 'push') {
          found.add(DEVICES_UPDATED_EVENT);
          break;
        }
        const path = RECIPIENT_PROPERTY[c.channel];
        if (path !== undefined) found.add(profileUpdatedEvent(path));
        break;
      }
      case 'payload':
        break; // only appears inside performed.where, which is not walked
    }
  }
  await walk(condition);
  return [...found];
}
