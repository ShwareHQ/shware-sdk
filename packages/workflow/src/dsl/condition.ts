import type { ConditionIR, SourceLocIR } from '../ir';
import { captureLoc } from '../provenance';
import { type Duration, durationIR } from './base';
import type { EventRef, UserPropertyRef } from './refs';

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

const cond = (ir: ConditionIR): Condition => {
  const impl: ConditionInternal = { __condition: true, ir };
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

function prop(
  ref: UserPropertyRef<unknown>,
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
  values?: readonly Scalar[]
): Condition {
  return cond({
    type: 'property',
    path: ref.path,
    op,
    ...(value !== undefined ? { value } : {}),
    ...(values !== undefined ? { values: [...values] } : {}),
  });
}

export function eq<T>(ref: UserPropertyRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'eq', value as Scalar);
}
export function ne<T>(ref: UserPropertyRef<T>, value: NoInfer<T>): Condition {
  return prop(ref, 'ne', value as Scalar);
}
export function gt<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition {
  return prop(ref, 'gt', value);
}
export function gte<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition {
  return prop(ref, 'gte', value);
}
export function lt<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition {
  return prop(ref, 'lt', value);
}
export function lte<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition {
  return prop(ref, 'lte', value);
}
export function between<T extends string | number>(
  ref: UserPropertyRef<T>,
  min: NoInfer<T>,
  max: NoInfer<T>
): Condition {
  return prop(ref, 'between', undefined, [min, max]);
}
export function notBetween<T extends string | number>(
  ref: UserPropertyRef<T>,
  min: NoInfer<T>,
  max: NoInfer<T>
): Condition {
  return prop(ref, 'not_between', undefined, [min, max]);
}
export function inArray<T>(ref: UserPropertyRef<T>, values: readonly NoInfer<T>[]): Condition {
  return prop(ref, 'in_array', undefined, values as readonly Scalar[]);
}
export function notInArray<T>(ref: UserPropertyRef<T>, values: readonly NoInfer<T>[]): Condition {
  return prop(ref, 'not_in_array', undefined, values as readonly Scalar[]);
}
export function exists(ref: UserPropertyRef<unknown>): Condition {
  return prop(ref, 'exists');
}
export function notExists(ref: UserPropertyRef<unknown>): Condition {
  return prop(ref, 'not_exists');
}
export function contains<T extends string>(ref: UserPropertyRef<T>, value: string): Condition {
  return prop(ref, 'contains', value);
}
export function notContains<T extends string>(ref: UserPropertyRef<T>, value: string): Condition {
  return prop(ref, 'not_contains', value);
}

/**
 * Event predicate: performed an event (optionally within a window / at least N times).
 * "Did not perform" is `not(performed(...))` — expressed by the combinator, so
 * there is no separate notPerformed.
 */
export function performed(
  event: EventRef,
  opts?: { within?: Duration; count?: number }
): Condition {
  return cond({
    type: 'performed',
    event: event.name,
    ...(opts?.within !== undefined ? { within: durationIR(opts.within) } : {}),
    ...(opts?.count !== undefined ? { count: opts.count } : {}),
  });
}

/** Condition combinators: nest freely. */
export function and(...conditions: readonly Condition[]): Condition {
  return cond({ type: 'and', conditions: conditions.map(condIR) });
}
export function or(...conditions: readonly Condition[]): Condition {
  return cond({ type: 'or', conditions: conditions.map(condIR) });
}
export function not(condition: Condition): Condition {
  return cond({ type: 'not', condition: condIR(condition) });
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
 */
export function segment(name: string, condition: Condition): SegmentRef {
  const impl: SegmentInternal = {
    __condition: true,
    __segment: true,
    name,
    ir: { type: 'segment', segment: name },
    definition: condIR(condition),
    loc: captureLoc(segment),
  };
  return impl;
}
