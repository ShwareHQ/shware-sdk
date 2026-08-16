import type { ConditionIR, PropertyOperatorIR, ScalarIR } from '../ir';
import type { FactSource } from './ports';

/**
 * Evaluation options.
 * - anchorMs: the earliest instant `performed` counts events from — the goal
 *   guard anchors at workflow entry (a conversion must happen *after* entry),
 *   waitUntil at the moment the wait began (a wake must not be satisfied by
 *   pre-existing history). Combined with `within` by taking the later bound.
 */
export interface EvaluateOptions {
  anchorMs?: number;
}

/**
 * ConditionIR evaluation: pure logic, with facts injected through FactSource,
 * so the D1 implementation and the in-memory test one share a single set of
 * semantics and cannot drift into two evaluators.
 */
export async function evaluateCondition(
  condition: ConditionIR,
  facts: FactSource,
  nowMs: number,
  opts?: EvaluateOptions
): Promise<boolean> {
  switch (condition.type) {
    case 'and': {
      for (const child of condition.conditions) {
        if (!(await evaluateCondition(child, facts, nowMs, opts))) return false;
      }
      return true;
    }
    case 'or': {
      for (const child of condition.conditions) {
        if (await evaluateCondition(child, facts, nowMs, opts)) return true;
      }
      return false;
    }
    case 'not':
      return !(await evaluateCondition(condition.condition, facts, nowMs, opts));
    case 'segment': {
      const def = await facts.getSegmentCondition(condition.segment);
      if (def === undefined) {
        throw new Error(`Unknown segment: '${condition.segment}' (bundle not deployed?)`);
      }
      return evaluateCondition(def, facts, nowMs, opts);
    }
    case 'performed': {
      const bounds: number[] = [];
      if (condition.within !== undefined) bounds.push(nowMs - condition.within.ms);
      if (opts?.anchorMs !== undefined) bounds.push(opts.anchorMs);
      const sinceMs = bounds.length > 0 ? Math.max(...bounds) : undefined;
      const count = await facts.countEvents(condition.event, {
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(condition.where !== undefined ? { where: condition.where } : {}),
      });
      return count >= (condition.count ?? 1);
    }
    case 'property': {
      const actual = await facts.getProperty(condition.path);
      return compareProperty(condition, actual);
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
 * The set of event names a condition cares about — what wait_until subscribes
 * to for wake-ups. `performed` contributes its event; a property predicate
 * contributes PROFILE_UPDATED_EVENT (so /identify wakes the wait). Segment
 * references are expanded, which is why a FactSource is needed to resolve
 * their definitions.
 */
export async function relevantEvents(condition: ConditionIR, facts: FactSource): Promise<string[]> {
  const found = new Set<string>();
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
        const def = await facts.getSegmentCondition(c.segment);
        if (def) await walk(def);
        break;
      }
      case 'property':
        found.add(PROFILE_UPDATED_EVENT);
        break;
      case 'payload':
        break; // only appears inside performed.where, which is not walked
    }
  }
  await walk(condition);
  return [...found];
}
