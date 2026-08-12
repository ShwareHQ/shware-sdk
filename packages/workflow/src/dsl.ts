import ms from 'ms';
import { semanticHash } from './hash';
import {
  type BundleIR,
  BundleIR as BundleIRSchema,
  type ChannelIR,
  type ConditionIR,
  type DurationIR,
  type GoalIR,
  IR_VERSION,
  type MetaIR,
  type NodeIR,
  type PropValueIR,
  type TriggerIR,
  type WorkflowIR,
  WorkflowIR as WorkflowIRSchema,
} from './ir';

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
 */

/* ----------------------------------- Base ----------------------------------- */

/**
 * Event name → payload shape, supplied by the app (its analytics schema).
 * Constrained to `object` rather than `Record`: interfaces have no implicit
 * index signature, so a Record constraint would reject an interface-defined
 * schema. Event names come from `keyof E`, payloads from `E[N]`.
 */
export type EventMap = object;

/** Base shape of user properties; the app extends it with concrete fields. */
export interface UserPropertyBase {
  userId: string;
  email: string;
}

/** Duration literal: '1 hour' / '23 hours' / '30 days' — typos fail to compile. */
export type Duration = `${number} ${
  | 'second'
  | 'seconds'
  | 'minute'
  | 'minutes'
  | 'hour'
  | 'hours'
  | 'day'
  | 'days'
  | 'week'
  | 'weeks'}`;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** 'HH:mm'. TODO: validate at runtime — template literal types cannot express leading zeros. */
export type TimeOfDay = `${string}:${string}`;

/** Duration parsing delegates to `ms` (typed StringValue); Duration is its stricter, full-word subset. */
function durationIR(value: Duration): DurationIR {
  const millis = ms(value);
  if (typeof millis !== 'number' || Number.isNaN(millis) || millis < 0) {
    throw new Error(`Invalid duration: '${value}'`);
  }
  return { value, ms: millis };
}

/* --------------------------- References (type carriers) --------------------------- */

/**
 * User-property reference (drizzle's column equivalent), shared by predicates
 * (eq/gt/…) and message-prop personalization. The phantom type __t is how a
 * free function reads the property's type off the reference.
 */
export interface UserPropertyRef<T> {
  readonly type: 'user_property';
  readonly path: string;
  readonly __t?: T;
}

/** Event reference: the argument to `performed`; future payload where-clauses and value refs hang off it. */
export interface EventRef<P = unknown> {
  readonly type: 'event_ref';
  readonly name: string;
  readonly __p?: P;
}

/** Property reference table: `u.subscription_status` is a UserPropertyRef (drizzle's `users.email`). */
export type UserRefs<U> = { readonly [K in keyof U]-?: UserPropertyRef<U[K]> };

/** Event reference table: `e.purchase` is an EventRef. */
export type EventRefs<E> = { readonly [K in keyof E]-?: EventRef<E[K]> };

/**
 * Build the reference tables: the app calls each once in its schema module and
 * exports the result (implemented with a Proxy — property access *is* the reference).
 *
 *   export const u = user<UserProperty>();
 *   export const e = event<Event>();
 *
 * From then on predicates and personalization are all property access:
 * eq(u.subscription_status, 'active'), performed(e.purchase, { within: '30 days' }),
 * { plan: u.subscription_plan }.
 *
 * Properties are deliberately single-level: the data source is a database
 * table and is naturally flat, so nested paths are out of scope.
 */
export function user<U extends UserPropertyBase>(): UserRefs<U> {
  return new Proxy({} as UserRefs<U>, {
    get: (_target, prop) => ({ type: 'user_property', path: String(prop) }),
  });
}

export function event<E extends EventMap>(): EventRefs<E> {
  return new Proxy({} as EventRefs<E>, {
    get: (_target, prop) => ({ type: 'event_ref', name: String(prop) }),
  });
}

export type PropInput<T> = T | UserPropertyRef<T>;
export type PropsInput<P> = { [K in keyof P]: PropInput<P[K]> };

/** Props may be omitted when a template declares none, and are required when it does. */
export type MessageArgs<P> =
  Record<never, never> extends P ? [props?: PropsInput<P>] : [props: PropsInput<P>];

/* --------------------------------- Templates -------------------------------- */

export type Channel = 'email' | 'sms' | 'push' | 'in_app' | 'slack' | 'survey';

export type EmptyProps = Record<never, never>;

/**
 * Template reference: a top-level named asset, reusable across workflows and
 * versioned on its own. The props shape is declared here and checked at use.
 */
export interface TemplateRef<C extends Channel = Channel, P extends object = EmptyProps> {
  readonly channel: C;
  readonly key: string;
  readonly __props?: P;
}

/**
 * Template content: a component taking props (react-email and friends). Pass
 * the component, not a JSX element — that way P is inferred from the
 * component's own props signature, keeping the key, the content and every use
 * site aligned. The content system (rendering, liquid compat, i18n) is a
 * separate topic; this is a placeholder type.
 */
export type TemplateContent<P extends object> = (props: P) => unknown;

export interface TemplateFactory {
  email<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'email', P>;
  sms<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'sms', P>;
  push<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'push', P>;
  inApp<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'in_app', P>;
  slack<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'slack', P>;
  survey<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'survey', P>;
}

const makeTemplate =
  <C extends Channel>(channel: C) =>
  <P extends object = EmptyProps>(key: string, content?: TemplateContent<P>): TemplateRef<C, P> =>
    ({ channel, key, content }) as TemplateRef<C, P>;

/**
 * Template definition: a plain object — a template's type (its props shape) is
 * self-contained at the declaration site.
 *
 *   const welcome = template.email('onboarding_welcome');
 *   const offer = template.email('n2_offer', OfferEmail);   // P inferred from the component
 */
export const template: TemplateFactory = {
  email: makeTemplate('email'),
  sms: makeTemplate('sms'),
  push: makeTemplate('push'),
  inApp: makeTemplate('in_app'),
  slack: makeTemplate('slack'),
  survey: makeTemplate('survey'),
};

/* ----------------------------- Template registry ---------------------------- */

/** One email module: a default-exported component (plus an optional subject). */
export interface TemplateModule {
  default: (props: never) => unknown;
  subject?: unknown;
}

/** Derive template props from the component's signature — the contract is written once, on the component. */
export type PropsOf<M> = M extends { default: (props: infer P) => unknown }
  ? P extends object
    ? P
    : EmptyProps
  : EmptyProps;

export interface BoundTemplateFactory<R extends Record<string, TemplateModule>> {
  email<K extends keyof R & string>(key: K): TemplateRef<'email', PropsOf<R[K]>>;
}

/**
 * Template factory bound to a registry: **the registry types the key** — so
 * referencing an unregistered template fails to compile, while props types
 * flow in from the component signature (same pattern as the u/e tables).
 *
 *   import type { Emails } from '../emails';   // type-only: no react at runtime
 *   const t = templates<Emails>();
 *   export const welcome = t.email('welcome');
 */
export function templates<R extends Record<string, TemplateModule>>(): BoundTemplateFactory<R> {
  return { email: (key) => template.email(key) as never };
}

/* --------------------------- Conditions (expressions) -------------------------- */

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

const condIR = (c: Condition): ConditionIR => (c as ConditionInternal).ir;

/*
 * Property predicates: free functions in drizzle's eq/gt/inArray style, with
 * types flowing in from UserPropertyRef's phantom type. Operator applicability
 * is expressed as a signature constraint: gt/lt/between only accept
 * string|number references, contains only string ones, so passing a boolean
 * property to gt fails to compile. Mirrors customer.io's condition panel.
 *
 * Value parameters are always NoInfer: types flow in from the reference only,
 * which stops eq(ref, 'typo') from widening T to include the bad value.
 * TODO: JSON array 'where at least one'、JSON object 'has the property'。
 */

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

interface SegmentInternal extends SegmentRef {
  readonly ir: ConditionIR;
  /** The segment's own definition (SegmentIR.condition), as opposed to a by-name reference. */
  readonly definition: ConditionIR;
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
  };
  return impl;
}

/* ----------------------------------- Flow ----------------------------------- */

/** A reusable flow fragment (what `flow(...)` returns), referenced directly by branch arms. */
export interface Flow {
  readonly __flow: true;
}

interface FlowInternal extends Flow {
  readonly nodes: NodeIR[];
}

/** Sub-flow: a named fragment, or an inline callback (runs once at construction — builder in, builder out). */
export type SubFlow = Flow | ((w: FlowBuilder) => FlowBuilder);

/** A branch arm: the [condition, sub-flow] tuple — an [if, then] ordering convention. */
export type BranchCase = readonly [condition: Condition, flow: SubFlow];

/**
 * A branch argument: either a tuple arm, or a bare sub-flow meaning the default
 * arm. The bare form may appear once, and must come last (checked at runtime).
 */
export type BranchArm = BranchCase | SubFlow;

function resolveSubFlow(sub: SubFlow): NodeIR[] {
  if (typeof sub === 'function') {
    const builder = new FlowBuilderImpl();
    sub(builder);
    return builder.nodes;
  }
  return (sub as FlowInternal).nodes;
}

export interface FlowBuilder {
  /* ---- Messages: all six channels are one message node; separate methods buy channel-level typing ---- */
  email<P extends object>(template: TemplateRef<'email', P>, ...props: MessageArgs<P>): this;
  sms<P extends object>(template: TemplateRef<'sms', P>, ...props: MessageArgs<P>): this;
  push<P extends object>(template: TemplateRef<'push', P>, ...props: MessageArgs<P>): this;
  inApp<P extends object>(template: TemplateRef<'in_app', P>, ...props: MessageArgs<P>): this;
  slack<P extends object>(template: TemplateRef<'slack', P>, ...props: MessageArgs<P>): this;
  survey<P extends object>(template: TemplateRef<'survey', P>, ...props: MessageArgs<P>): this;

  /* --------------------------------- Delays --------------------------------- */
  /** Time Delay; passing { min, max } makes it a Randomized Delay. */
  delay(duration: Duration): this;
  delay(range: { min: Duration; max: Duration }): this;

  /** Time Window: hold until inside the window (e.g. weekdays 09:00–17:00). tz: 'user' uses the user's timezone. */
  timeWindow(opts: {
    days?: readonly Weekday[];
    between: readonly [TimeOfDay, TimeOfDay];
    tz?: 'user' | (string & {});
  }): this;

  /**
   * Wait Until: continue on the main line once the condition holds, or take
   * onTimeout when it expires (default 'continue'). On the engine side this is
   * "await event racing a timer" — a native primitive of durable runtimes.
   */
  waitUntil(
    condition: Condition,
    opts: { timeout: Duration; onTimeout?: 'continue' | 'exit' | SubFlow }
  ): this;

  /* ------------------------------ Flow Control ------------------------------ */
  /**
   * Conditional branch: ordered first-match (same semantics as Step Functions
   * Choice / Knock branch). This one primitive covers both the UI's True/False
   * Branch (two arms) and Multi-Split Branch (N arms). Arms are
   * [condition, sub-flow] tuples; a bare sub-flow in tail position is the
   * default arm. With no match and no default, execution simply continues.
   * Rejoin is structural: after the matching arm finishes, execution resumes
   * at the node following the branch — to opt out, call .exit() inside the arm.
   *
   *   .branch([activeSubscriber, upgradeFlow], firstTimeFlow)   // True/False
   *   .branch([vip, vipFlow], [trial, trialFlow], defaultFlow)  // Multi-Split
   *   .branch([not(usedStaging), eduFlow])                      // single arm: no match continues
   *
   * The optional first argument `label` becomes the node's name in IR (UI title
   * / observability handle). It is not a jump target — there is no goto here;
   * periodic or looping needs are expressed with a self-triggering sendEvent
   * (see sendEvent). Arm labels in the UI are derived from the condition.
   */
  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;

  /**
   * Gate: exit unless the condition holds, otherwise continue. A first-class
   * node rather than sugar over branch — same semantics as Zapier's "only
   * continue if" / Iterable's Filter tile, and rendered on its own in the UI.
   */
  filter(condition: Condition, opts?: { reason?: string }): this;

  /** Random Cohort Branch (A/B): weights must sum to 100 (checked at runtime). */
  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>): this;

  /**
   * Exit: end the whole workflow immediately (the UI's Exit node); `reason`
   * goes into the audit log. Inside a branch arm this means "terminate, do not
   * rejoin" — the arm stops here instead of falling through to the main line,
   * while an arm without exit rejoins naturally.
   */
  exit(reason?: string): this;

  /* ---------------------------------- Data ---------------------------------- */
  /**
   * Emit a typed event (customer.io's Send Event). The event comes from an
   * e.xxx reference, so payload types flow in the same way trigger.event works.
   * This is how workflows compose: an event can trigger another workflow, and
   * the resulting call graph is statically analyzable. It is also the official
   * shape of a "loop" — the workflow itself stays a tree, and a trailing
   * self-triggering sendEvent plus a goal plus a trigger rate limit gives you a
   * periodic flow. Payload values may reference u.xxx.
   * TODO: the rest of the Data category — outbound webhook / profile update /
   * journey attributes.
   */
  sendEvent<P extends object>(event: EventRef<P>, ...payload: MessageArgs<P>): this;
}

class FlowBuilderImpl implements FlowBuilder {
  /** Nodes as collected; ids are assigned in one pass inside toIR, so '' is a placeholder here. */
  readonly nodes: NodeIR[] = [];

  private pushNode(node: NodeIR): this {
    this.nodes.push(node);
    return this;
  }

  private message(channel: ChannelIR, tpl: TemplateRef<Channel, object>, props?: object): this {
    return this.pushNode({
      id: '',
      type: 'message',
      channel,
      template: tpl.key,
      props: (props ?? {}) as Record<string, PropValueIR>,
    });
  }

  email<P extends object>(t: TemplateRef<'email', P>, ...args: MessageArgs<P>): this {
    return this.message('email', t, args[0]);
  }
  sms<P extends object>(t: TemplateRef<'sms', P>, ...args: MessageArgs<P>): this {
    return this.message('sms', t, args[0]);
  }
  push<P extends object>(t: TemplateRef<'push', P>, ...args: MessageArgs<P>): this {
    return this.message('push', t, args[0]);
  }
  inApp<P extends object>(t: TemplateRef<'in_app', P>, ...args: MessageArgs<P>): this {
    return this.message('in_app', t, args[0]);
  }
  slack<P extends object>(t: TemplateRef<'slack', P>, ...args: MessageArgs<P>): this {
    return this.message('slack', t, args[0]);
  }
  survey<P extends object>(t: TemplateRef<'survey', P>, ...args: MessageArgs<P>): this {
    return this.message('survey', t, args[0]);
  }

  delay(duration: Duration): this;
  delay(range: { min: Duration; max: Duration }): this;
  delay(d: Duration | { min: Duration; max: Duration }): this {
    if (typeof d === 'string') {
      return this.pushNode({ id: '', type: 'delay', duration: durationIR(d) });
    }
    return this.pushNode({
      id: '',
      type: 'random_delay',
      min: durationIR(d.min),
      max: durationIR(d.max),
    });
  }

  timeWindow(opts: {
    days?: readonly Weekday[];
    between: readonly [TimeOfDay, TimeOfDay];
    tz?: 'user' | (string & {});
  }): this {
    return this.pushNode({
      id: '',
      type: 'time_window',
      days: [...(opts.days ?? (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const))],
      between: [opts.between[0], opts.between[1]],
      tz: opts.tz ?? 'user',
    });
  }

  waitUntil(
    condition: Condition,
    opts: { timeout: Duration; onTimeout?: 'continue' | 'exit' | SubFlow }
  ): this {
    const onTimeout = opts.onTimeout ?? 'continue';
    return this.pushNode({
      id: '',
      type: 'wait_until',
      condition: condIR(condition),
      timeout: durationIR(opts.timeout),
      onTimeout:
        onTimeout === 'continue' || onTimeout === 'exit' ? onTimeout : resolveSubFlow(onTimeout),
    });
  }

  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;
  branch(...args: readonly (string | BranchArm)[]): this {
    const label = typeof args[0] === 'string' ? args[0] : undefined;
    const arms = (label === undefined ? args : args.slice(1)) as readonly BranchArm[];

    const cases: { condition: ConditionIR; flow: NodeIR[] }[] = [];
    let otherwise: NodeIR[] | undefined;
    arms.forEach((arm, i) => {
      if (Array.isArray(arm)) {
        if (otherwise !== undefined) {
          throw new Error('branch(): default arm (bare sub-flow) must be the last argument');
        }
        const [condition, sub] = arm as BranchCase;
        cases.push({ condition: condIR(condition), flow: resolveSubFlow(sub) });
      } else {
        if (otherwise !== undefined) {
          throw new Error('branch(): only one default arm (bare sub-flow) is allowed');
        }
        if (i !== arms.length - 1) {
          throw new Error('branch(): default arm (bare sub-flow) must be the last argument');
        }
        otherwise = resolveSubFlow(arm as SubFlow);
      }
    });

    return this.pushNode({
      id: '',
      type: 'branch',
      ...(label !== undefined ? { label } : {}),
      cases,
      ...(otherwise !== undefined ? { otherwise } : {}),
    });
  }

  filter(condition: Condition, opts?: { reason?: string }): this {
    return this.pushNode({
      id: '',
      type: 'filter',
      condition: condIR(condition),
      ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    });
  }

  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>): this {
    const entries = Object.entries(arms);
    const total = entries.reduce((sum, [, a]) => sum + a.weight, 0);
    if (total !== 100) {
      throw new Error(`cohort(): weights must sum to 100, got ${total}`);
    }
    return this.pushNode({
      id: '',
      type: 'cohort',
      arms: entries.map(([name, a]) => ({
        name,
        weight: a.weight,
        flow: a.flow ? resolveSubFlow(a.flow) : [],
      })),
    });
  }

  exit(reason?: string): this {
    return this.pushNode({ id: '', type: 'exit', ...(reason !== undefined ? { reason } : {}) });
  }

  sendEvent<P extends object>(ev: EventRef<P>, ...payload: MessageArgs<P>): this {
    return this.pushNode({
      id: '',
      type: 'send_event',
      event: ev.name,
      payload: (payload[0] ?? {}) as Record<string, PropValueIR>,
    });
  }
}

/**
 * A reusable flow fragment: a free function. Once personalization goes through
 * u.xxx and events through e.xxx, the flow layer carries no schema generics.
 */
export function flow(build: (w: FlowBuilder) => FlowBuilder): Flow {
  const builder = new FlowBuilderImpl();
  build(builder);
  const impl: FlowInternal = { __flow: true, nodes: builder.nodes };
  return impl;
}

/* --------------------------------- trigger --------------------------------- */

/** 'YYYY-MM-DD HH:mm:ss'. TODO: validate at runtime — template literals cannot express leading zeros. */
export type DateTime = string;

/** Trigger reference: what trigger.xxx() returns, reusable across workflows. */
export interface TriggerRef {
  readonly type: 'event' | 'segment' | 'date' | 'webhook';
}

interface TriggerInternal extends TriggerRef {
  readonly ir: TriggerIR;
}

const makeTrigger = (ir: TriggerIR): TriggerRef => {
  const impl: TriggerInternal = { type: ir.type, ir };
  return impl;
};

/** Trigger factory: four ways in, mirroring customer.io's campaign trigger types. */
export interface TriggerFactory {
  /**
   * Event trigger: the event name comes from an e.xxx reference (types flow in
   * from it, so the factory itself needs no generics). `filter` is the entry
   * gate — a condition on the profile, customer.io's trigger Filters: the user
   * enters only if the event fired *and* the filter holds.
   * TODO: payload filtering (a where clause; P is reserved for it).
   */
  event<P>(event: EventRef<P>, opts?: { filter?: Condition }): TriggerRef;

  /**
   * Segment-entry trigger: the user enters the moment they go from not
   * matching to matching. Only a named segment is accepted — entry semantics
   * need a continuously materialized membership table, which an anonymous
   * expression cannot provide.
   */
  segment(segment: SegmentRef): TriggerRef;

  /** Scheduled trigger (one-shot, e.g. '2026-12-25 09:00:00' for a holiday push). TODO: cron. */
  date(at: DateTime): TriggerRef;

  /** Webhook trigger: third-party or external code fires it via a URL; the runtime allocates the endpoint. */
  webhook(): TriggerRef;
}

/**
 * Trigger definition: a plain object — event names come from e.xxx references.
 *
 *   const login = trigger.event(e.login, { filter: newUsers7d });
 */
export const trigger: TriggerFactory = {
  event: (ev, opts) =>
    makeTrigger({
      type: 'event',
      event: ev.name,
      ...(opts?.filter !== undefined ? { filter: condIR(opts.filter) } : {}),
    }),
  segment: (seg) => makeTrigger({ type: 'segment', segment: seg.name }),
  date: (at) => makeTrigger({ type: 'date', at }),
  webhook: () => makeTrigger({ type: 'webhook' }),
};

/* --------------------------------- workflow --------------------------------- */

/** Full conversion-goal configuration (customer.io's Goal & Exit semantics). */
export interface GoalOptions {
  condition: Condition;
  /** Attribution window: how long after entry a match still counts as a conversion. Unbounded by default. */
  within?: Duration;
  /** Exit on conversion. Defaults to true — this is what absorbs all those True→Exit arms in a UI canvas. */
  exitOnMatch?: boolean;
}

export interface WorkflowOptions {
  /** Trigger: a trigger.xxx() asset. TODO: multiple triggers, entry frequency / re-entry policy. */
  trigger: TriggerRef;

  /**
   * Conversion goal: feeds reporting (conversion rate / attribution) and by
   * default exits on match. Checked before each node runs. Pass a condition
   * for the shorthand, or GoalOptions for the full form.
   */
  goal?: Condition | GoalOptions;

  /** Plain exit condition: leaving without counting as a conversion (unsubscribed, no longer eligible). Coexists with goal. */
  exitWhen?: Condition;

  /*
   * Everything below is human-facing metadata: it lands in IR's `meta` field
   * and is **excluded from contentHash**. Editing it neither invalidates the
   * version in-flight users are pinned to nor shows up as a change in plan.
   */

  /** One line on what this flow does (UI lists, plan output). */
  description?: string;
  /** Grouping tags (UI filtering). */
  tags?: readonly string[];
  /** Owner (shown in the UI, used for alert routing). */
  owner?: string;
}

export interface WorkflowBuilder extends FlowBuilder {
  toIR(): WorkflowIR;
}

/* ---------------------------- Compilation (→ IR) ---------------------------- */

/**
 * Assign node ids from the structural path (rules in ir.ts's header). Written
 * in place into the tree toIR deep-cloned, never into the builder's own nodes.
 */
function assignIds(nodes: NodeIR[], prefix: string): void {
  nodes.forEach((node, i) => {
    const id = prefix === '' ? String(i) : `${prefix}.${i}`;
    node.id = id;
    switch (node.type) {
      case 'branch':
        node.cases.forEach((c, ci) => assignIds(c.flow, `${id}.c${ci}`));
        if (node.otherwise) assignIds(node.otherwise, `${id}.o`);
        break;
      case 'cohort':
        node.arms.forEach((arm) => assignIds(arm.flow, `${id}.${arm.name}`));
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) assignIds(node.onTimeout, `${id}.t`);
        break;
      default:
        break;
    }
  });
}

class WorkflowBuilderImpl extends FlowBuilderImpl implements WorkflowBuilder {
  constructor(
    private readonly name: string,
    private readonly options: WorkflowOptions
  ) {
    super();
  }

  private goalIR(): GoalIR | undefined {
    const goal = this.options.goal;
    if (goal === undefined) return undefined;
    if ('__condition' in goal) {
      return { condition: condIR(goal), exitOnMatch: true };
    }
    return {
      condition: condIR(goal.condition),
      ...(goal.within !== undefined ? { within: durationIR(goal.within) } : {}),
      exitOnMatch: goal.exitOnMatch ?? true,
    };
  }

  private metaIR(): MetaIR | undefined {
    const { description, tags, owner } = this.options;
    if (description === undefined && tags === undefined && owner === undefined) return undefined;
    return {
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags: [...tags] } : {}),
      ...(owner !== undefined ? { owner } : {}),
    };
  }

  toIR(): WorkflowIR {
    const flowNodes = structuredClone(this.nodes);
    assignIds(flowNodes, '');
    const goal = this.goalIR();
    const meta = this.metaIR();
    const body = {
      irVersion: IR_VERSION,
      name: this.name,
      ...(meta !== undefined ? { meta } : {}),
      trigger: (this.options.trigger as TriggerInternal).ir,
      ...(goal !== undefined ? { goal } : {}),
      ...(this.options.exitWhen !== undefined ? { exitWhen: condIR(this.options.exitWhen) } : {}),
      flow: flowNodes,
    };
    // semanticHash strips meta / label, so metadata edits leave contentHash alone
    // Self-check: the compiler's output must pass IR's authoritative schema
    return WorkflowIRSchema.parse({ ...body, contentHash: semanticHash(body) });
  }
}

/** Workflow definition: a name, configuration (trigger / goal / exitWhen), and chained steps. */
export function workflow(name: string, options: WorkflowOptions): WorkflowBuilder {
  return new WorkflowBuilderImpl(name, options);
}

/* --------------------------------- bundle --------------------------------- */

/**
 * Compile a deployment unit: workflows + segments (+ template manifest) → BundleIR.
 * This is `deploy`'s input (terraform-apply mental model); the server diffs each
 * definition by contentHash.
 */
export function compileBundle(input: {
  workflows: readonly WorkflowBuilder[];
  segments?: readonly SegmentRef[];
  templates?: readonly TemplateRef[];
}): BundleIR {
  const segments = (input.segments ?? []).map((segment) => {
    const { name, definition } = segment as SegmentInternal;
    return {
      irVersion: IR_VERSION,
      name,
      contentHash: semanticHash(definition),
      condition: definition,
    };
  });

  const templates = (input.templates ?? []).map((template) => ({
    irVersion: IR_VERSION,
    key: template.key,
    channel: template.channel,
  }));

  const workflows = input.workflows.map((builder) => builder.toIR());

  // Names are wire identity (routing tables, entry ledger, by-name refs):
  // duplicates would silently last-write-win on deploy, so fail the compile.
  assertUniqueNames(
    workflows.map((w) => w.name),
    'workflow'
  );
  assertUniqueNames(
    segments.map((s) => s.name),
    'segment'
  );

  return BundleIRSchema.parse({ irVersion: IR_VERSION, workflows, segments, templates });
}

function assertUniqueNames(names: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`compileBundle: duplicate ${kind} name '${name}'`);
    seen.add(name);
  }
}
