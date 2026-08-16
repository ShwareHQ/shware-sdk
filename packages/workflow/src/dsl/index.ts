/**
 * Workflow DSL — surface types plus the compiler (chained calls and
 * expressions are collected into IR at construction time).
 *
 * Design principles:
 * 1. Fully declarative: chains and condition expressions build a serializable
 *    graph (IR), never runtime code. Sub-flow callbacks run exactly once at
 *    construction (builder in, builder out) and runtime values are always data
 *    references (UserPropertyRef) — closures are not allowed.
 * 2. drizzle-style typing: generics live only on the two reference tables
 *    (`u = user<UserProperty>()` and `e = event<Event>()`, the only type
 *    injection points). Everything else is a generic-free free function or
 *    object (predicates eq/gt/…, combinators and/or/not, segment / template /
 *    trigger / flow / workflow), with types flowing in from a reference's
 *    phantom type. There is no central factory.
 * 3. Three layers: reference tables (u / e) → reusable assets (template /
 *    segment / trigger) → flow primitives (workflow + FlowBuilder chain) and
 *    condition expressions (predicate composition).
 * 4. options = configuration (trigger / goal / exitWhen); the chain = steps.
 *
 * One concept per module; this barrel is the public API — internal seams
 * (condIR, durationIR, FlowBuilderImpl, *Internal shapes) are deliberately
 * not re-exported here.
 */

export type { Duration, EventMap, TimeOfDay, UserPropertyBase, Weekday } from './base';
export {
  type EventRef,
  type EventRefs,
  type MessageArgs,
  type PropInput,
  type PropsInput,
  type UserPropertyRef,
  type UserRefs,
  event,
  user,
} from './refs';
export {
  type BoundTemplateFactory,
  type Channel,
  type EmptyProps,
  type PropsOf,
  type TemplateContent,
  type TemplateFactory,
  type TemplateModule,
  type TemplateRef,
  template,
  templates,
} from './template';
export { type SubjectPlaceholders, emailSubject } from './subject';
export {
  type Condition,
  type SegmentRef,
  and,
  between,
  contains,
  eq,
  exists,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notContains,
  notExists,
  notInArray,
  or,
  performed,
  segment,
} from './condition';
export {
  type BranchArm,
  type BranchCase,
  type Flow,
  type FlowBuilder,
  type SubFlow,
  flow,
} from './flow';
export { type DateTime, type TriggerFactory, type TriggerRef, trigger } from './trigger';
export { type GoalOptions, type WorkflowBuilder, type WorkflowOptions, workflow } from './workflow';
export { compileBundle } from './bundle';
