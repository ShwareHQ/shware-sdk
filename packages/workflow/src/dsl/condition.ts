import type { ConditionIR, SourceLocIR } from '../ir';
import { captureLoc } from '../provenance';
import { type Duration, durationIR } from './base';
import {
  type EventRef,
  type PayloadRef,
  type PayloadRefs,
  type UserPropertyRef,
  payloadRefs,
} from './refs';

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
  return cond(
    {
      type: ref.type === 'payload_ref' ? 'payload' : 'property',
      path: ref.path,
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
  within?: Duration;
  count?: number;
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
  return cond(
    {
      type: 'performed',
      event: event.name,
      ...(where !== undefined ? { where: condIR(where(payloadRefs<P>())) } : {}),
      ...(opts?.within !== undefined ? { within: durationIR(opts.within) } : {}),
      ...(opts?.count !== undefined ? { count: opts.count } : {}),
    },
    captureLoc(performed)
  );
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
 * the UI sidebar, is reusable across workflows, is referenced by name in IR,
 * and has a continuously materialized membership count (the prerequisite for
 * segment triggers). Anonymous reuse is just a const expression; a one-off
 * check is an inline expression at the use site.
 * TODO, to match customer.io's panel: form / page / device / screen /
 * opt-out / message data（email opened、sms clicked、webhook …）
 */
export interface SegmentRef extends Condition {
  readonly __segment: true;
  readonly name: string;
}

/** @internal the compiled shape behind a SegmentRef — compileBundle reads definition/loc off it */
export interface SegmentInternal extends SegmentRef {
  readonly ir: ConditionIR;
  /** Human label / description; metadata, so never part of the hash. */
  readonly meta: SegmentMeta | undefined;
  /** The segment's own definition (SegmentIR.condition), as opposed to a by-name reference. */
  readonly definition: ConditionIR;
  /** Callsite of the segment() call (provenance; lands in SegmentIR.meta.loc). */
  readonly loc: SourceLocIR | undefined;
}

/**
 * Segment definition: a free function — the expression's types were already
 * checked at the predicates.
 *
 *   export const purchaser = segment('purchaser', performed(e.purchase, { within: '30 days' }));
 *
 * The first argument is wire identity — by-name references and the membership
 * store are keyed on it, so it is not something to rename for readability. The
 * optional third argument is: `{ name, description }` are metadata, dropped
 * before hashing, and the studio both shows and edits them.
 */
/** Labels for a segment: what the studio shows instead of the wire key. */
export interface SegmentMeta {
  name?: string;
  description?: string;
}

export function segment(name: string, condition: Condition, meta?: SegmentMeta): SegmentRef {
  const impl: SegmentInternal = {
    __condition: true,
    __segment: true,
    name,
    ir: { type: 'segment', segment: name },
    definition: condIR(condition),
    loc: captureLoc(segment),
    meta,
  };
  return impl;
}
