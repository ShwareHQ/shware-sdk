import type { ConditionIR, DurationIR, SourceLocIR } from '../ir';
import { captureLoc } from '../provenance';
import { type Duration, durationIR } from './base';
import {
  type EventRef,
  PAYLOAD_PATH,
  type PayloadRef,
  type PayloadRefs,
  type UserPropertyRef,
  payloadRefs,
} from './refs';
import type { Channel } from './template';

/**
 * Conditions — drizzle-style predicate expressions: free functions (eq/gt/…)
 * composed with and/or/not, plus `segment` for naming an expression as a
 * top-level asset. A condition is an opaque handle wrapping its ConditionIR.
 *
 * Type techniques:
 * - Types flow in from the reference's phantom type; operator applicability is
 *   a signature constraint (gt only takes string|number refs, contains only
 *   string ones), mirroring customer.io's condition panel.
 * - Value parameters are always NoInfer: types come from the reference only,
 *   which stops eq(ref, 'typo') from widening T to include the bad value.
 *
 * TODO: JSON array 'where at least one'、JSON object 'has the property'。
 */

/** Opaque condition handle — what predicates, combinators and segments all produce. */
export interface Condition {
  readonly __condition: true;
}

interface ConditionInternal extends Condition {
  readonly ir: ConditionIR;
}

const cond = (ir: ConditionIR, loc?: SourceLocIR): Condition => {
  const impl: ConditionInternal = {
    __condition: true,
    ir: loc === undefined ? ir : { ...ir, meta: { loc } },
  };
  return impl;
};

/** @internal unwrap a condition to its IR — used by flow/trigger/workflow builders */
export const condIR = (c: Condition): ConditionIR => {
  // Partial: the cast is unsound for hand-rolled objects — exactly what this checks
  const ir = (c as Partial<ConditionInternal>).ir;
  if (ir === undefined) {
    // A hand-rolled `{ __condition: true }` would otherwise surface as a
    // baffling zod error at toIR() time, far away from the actual mistake.
    throw new Error(
      'Condition was not created by this DSL — use the predicates (eq/gt/…), combinators (and/or/not) or segment()'
    );
  }
  return ir;
};

type Scalar = string | number | boolean;

/**
 * Predicates accept either kind of reference: a user property (profile
 * condition) or an event payload field (only valid inside a `where` — the
 * bundle compiler enforces the placement, since both produce `Condition`).
 */
type CondRef<T> = UserPropertyRef<T> | PayloadRef<T>;

/**
 * A payload ref identifies itself by a symbol key, and a user-property ref by
 * the absence of one. Nothing here reads a *string* key off the reference: a
 * payload ref hands out sub-refs for every string key, so a field named `type`
 * or `path` would otherwise answer in place of the ref itself.
 */
const payloadPathOf = (ref: CondRef<unknown>): string | undefined =>
  (ref as Partial<PayloadRef<unknown>>)[PAYLOAD_PATH];

function prop(
  ref: CondRef<unknown>,
  op:
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'not_between'
    | 'in_array'
    | 'not_in_array'
    | 'exists'
    | 'not_exists'
    | 'contains'
    | 'not_contains',
  value?: Scalar,
  values?: readonly Scalar[],
  loc?: SourceLocIR
): Condition {
  const payloadPath = payloadPathOf(ref);
  return cond(
    {
      type: payloadPath !== undefined ? 'payload' : 'property',
      path: payloadPath ?? (ref as UserPropertyRef<unknown>).path,
      op,
      ...(value !== undefined ? { value } : {}),
      ...(values !== undefined ? { values: [...values] } : {}),
    },
    loc
  );
}

export function eq<T>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'eq', value as Scalar, undefined, captureLoc(eq));
}
export function ne<T>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'ne', value as Scalar, undefined, captureLoc(ne));
}
export function gt<T extends string | number>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'gt', value, undefined, captureLoc(gt));
}
export function gte<T extends string | number>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'gte', value, undefined, captureLoc(gte));
}
export function lt<T extends string | number>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'lt', value, undefined, captureLoc(lt));
}
export function lte<T extends string | number>(ref: CondRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'lte', value, undefined, captureLoc(lte));
}
export function between<T extends string | number>(
  ref: CondRef<T>,
  min: NoInfer<T>,
  max: NoInfer<T>
): Condition {
  return prop(ref, 'between', undefined, [min, max], captureLoc(between));
}
export function notBetween<T extends string | number>(
  ref: CondRef<T>,
  min: NoInfer<T>,
  max: NoInfer<T>
): Condition {
  return prop(ref, 'not_between', undefined, [min, max], captureLoc(notBetween));
}
export function inArray<T>(ref: CondRef<T>, values: readonly NoInfer<T>[]): Condition {
  return prop(ref, 'in_array', undefined, values as readonly Scalar[], captureLoc(inArray));
}
export function notInArray<T>(ref: CondRef<T>, values: readonly NoInfer<T>[]): Condition {
  return prop(ref, 'not_in_array', undefined, values as readonly Scalar[], captureLoc(notInArray));
}
export function exists(ref: CondRef<unknown>): Condition {
  return prop(ref, 'exists', undefined, undefined, captureLoc(exists));
}
export function notExists(ref: CondRef<unknown>): Condition {
  return prop(ref, 'not_exists', undefined, undefined, captureLoc(notExists));
}
export function contains<T extends string>(ref: CondRef<T>, value: string): Condition {
  return prop(ref, 'contains', value, undefined, captureLoc(contains));
}
export function notContains<T extends string>(ref: CondRef<T>, value: string): Condition {
  return prop(ref, 'not_contains', value, undefined, captureLoc(notContains));
}

export interface PerformedOptions {
  /** Only occurrences this recent count; must be a positive duration. */
  within?: Duration;
  /** At least this many occurrences; a positive integer (1 is the default). */
  count?: number;
}

/**
 * @internal A duration that has to elapse — a wait's timeout, a goal's window, a performed
 * window. Zero parses as a valid duration but means "never" or "always" depending on the node,
 * and either way it is not what the author meant.
 */
export function positiveDurationIR(value: Duration, what: string): DurationIR {
  const ir = durationIR(value);
  if (ir.ms <= 0) throw new Error(`${what} must be positive, got '${value}'`);
  return ir;
}

/** A payload where clause: an arrow taking the typed payload-ref table. Runs once at construction — the result is a serializable condition tree in IR, never a closure. */
export type PayloadWhere<P> = (p: PayloadRefs<P>) => Condition;

/**
 * Event predicate: performed an event (optionally within a window / at least N
 * times). "Did not perform" is `not(performed(...))` — expressed by the
 * combinator, so there is no separate notPerformed.
 *
 * The optional second argument narrows which events count by their payload —
 * an arrow receiving a typed payload reference table, with the ordinary
 * predicates applying. It compiles to a `where` subtree in IR (data the UI
 * renders), not a runtime closure:
 *
 *   performed(e.login)
 *   performed(e.login, (p) => and(eq(p.platform, 'web'), eq(p.tags.utm_source, 'meta')))
 *   performed(e.purchase, (p) => gt(p.value, 100), { within: '30 days', count: 2 })
 *   performed(e.purchase, { within: '30 days' })                 // options without a where
 *
 * Time anchoring: evaluated inside a `goal` the count starts at workflow
 * entry, inside `waitUntil` at the moment the wait began (the engine anchors
 * them — a conversion or a wake must not be satisfied by pre-existing
 * history). Everywhere else (branch/filter/exitWhen/segments) it looks over
 * full history, bounded only by `within`.
 */
export function performed<P>(event: EventRef<P>, opts?: PerformedOptions): Condition;
export function performed<P>(
  event: EventRef<P>,
  where: PayloadWhere<P>,
  opts?: PerformedOptions
): Condition;
export function performed<P>(
  event: EventRef<P>,
  whereOrOpts?: PayloadWhere<P> | PerformedOptions,
  maybeOpts?: PerformedOptions
): Condition {
  const where = typeof whereOrOpts === 'function' ? whereOrOpts : undefined;
  const opts = typeof whereOrOpts === 'function' ? maybeOpts : whereOrOpts;
  // count: 0 is satisfied by nobody having done anything, and a fraction is never reached
  if (opts?.count !== undefined && (!Number.isInteger(opts.count) || opts.count < 1)) {
    throw new Error(`performed(): count must be a positive integer, got ${String(opts.count)}`);
  }
  return cond(
    {
      type: 'performed',
      event: event.name,
      ...(where !== undefined ? { where: condIR(where(payloadRefs<P>())) } : {}),
      ...(opts?.within !== undefined
        ? { within: positiveDurationIR(opts.within, 'performed(): within') }
        : {}),
      ...(opts?.count !== undefined ? { count: opts.count } : {}),
    },
    captureLoc(performed)
  );
}

/**
 * The user can be reached on a channel right now. For push it asks the host's
 * device directory (at least one device listed) — the engine keeps no device
 * state, so this is the way to branch on "has the app on a device that allowed
 * notifications"; for the other channels it checks the recipient property
 * (`email`, `phone`, …). Inside `waitUntil` it wakes on device changes
 * (`POST /devices/changed`) or profile updates respectively.
 *
 *   .branch([reachable('push'), (w) => w.push(tip)], (w) => w.email(tip))
 *
 * (`.prefer([push.tip, email.tip], props)` is this branch for one push and one email.)
 */
export function reachable(channel: Channel): Condition {
  return cond({ type: 'reachable', channel }, captureLoc(reachable));
}

/** Condition combinators: nest freely. */
export function and(...conditions: readonly Condition[]): Condition {
  return cond({ type: 'and', conditions: conditions.map(condIR) }, captureLoc(and));
}
export function or(...conditions: readonly Condition[]): Condition {
  return cond({ type: 'or', conditions: conditions.map(condIR) }, captureLoc(or));
}
export function not(condition: Condition): Condition {
  return cond({ type: 'not', condition: condIR(condition) }, captureLoc(not));
}

/**
 * Segment: a named condition expression and a top-level asset — it shows up in
 * the UI sidebar, is reusable across workflows, is referenced by id in IR,
 * and has a continuously materialized membership count (the prerequisite for
 * segment triggers). Anonymous reuse is just a const expression; a one-off
 * check is an inline expression at the use site.
 * TODO, to match customer.io's panel: form / page / device / screen /
 * opt-out / message data（email opened、sms clicked、webhook …）
 */
export interface SegmentRef extends Condition {
  readonly __segment: true;
  /** Wire identity: segment references and the membership store are keyed on it (`SegmentIR.id`). */
  readonly id: string;
}

/** @internal the compiled shape behind a SegmentRef — compileBundle reads definition/loc off it */
export interface SegmentInternal extends SegmentRef {
  readonly ir: ConditionIR;
  /** Human label / description; metadata, so never part of the hash. */
  readonly meta: SegmentMeta | undefined;
  /** The segment's own definition (SegmentIR.condition), as opposed to a reference by id. */
  readonly definition: ConditionIR;
  /** Callsite of the segment() call (provenance; lands in SegmentIR.meta.loc). */
  readonly loc: SourceLocIR | undefined;
}

/** Labels for a segment: what the studio shows instead of the wire key. */
export interface SegmentMeta {
  name?: string;
  description?: string;
}

export interface SegmentDefinition extends SegmentMeta {
  /**
   * Wire identity — by-name references and the membership store are keyed on
   * it, so it is not something to rename for readability.
   */
  id: string;
  /** Who is in the segment; the predicates already checked its types. */
  condition: Condition;
}

/**
 * Segment definition. `name` and `description` are optional labels: metadata,
 * dropped before hashing, and what the studio shows.
 *
 *   export const purchaser = segment({
 *     id: 'purchaser',
 *     name: 'Purchased (last 30d)',
 *     condition: performed(e.purchase, { within: '30 days' }),
 *   });
 */
export function segment({ id, condition, name, description }: SegmentDefinition): SegmentRef {
  const meta: SegmentMeta = {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  };
  const impl: SegmentInternal = {
    __condition: true,
    __segment: true,
    id,
    ir: { type: 'segment', segment: id },
    definition: condIR(condition),
    loc: captureLoc(segment),
    meta: Object.keys(meta).length === 0 ? undefined : meta,
  };
  return impl;
}
