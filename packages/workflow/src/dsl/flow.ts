import type { ChannelIR, ConditionIR, NodeIR, PropValueIR, SourceLocIR } from '../ir';
import { captureLoc } from '../provenance';
import {
  type AnyTemplate,
  CHANNEL_OF,
  type DiscordTemplate,
  type EmailTemplate,
  type PropsSchema,
  type PushTemplate,
  type SlackTemplate,
  isTemplate,
} from '../templates';
import type { ActionRef } from './action';
import { type Duration, type TimeOfDay, type Weekday, durationIR, timeOfDayMinutes } from './base';
import { type Condition, condIR } from './condition';
import type { EventRef, MessageArgs, PropInput, PropsInput } from './refs';
import type { PropsOf, TemplateRef } from './template';

/**
 * The flow chain — FlowBuilder is the DSL's step surface (messages, delays,
 * flow control, data), and its implementation is the compiler front half: each
 * chained call executes no logic, it just collects one IR node (ids are
 * assigned later, in workflow.toIR()). Sub-flow callbacks run exactly once at
 * construction — builder in, builder out — so the output is always a static
 * tree.
 *
 * Every public method also captures its callsite (provenance): the loc lands
 * in the node's hash-excluded meta and is the anchor for future in-place
 * editing from the studio.
 */

type Scalar = string | number | boolean;

/** An emitted field: a scalar (or a profile ref to one); a nested field cannot be sent. */
type EmitValue<T> = [NonNullable<T>] extends [Scalar] ? PropInput<T> : never;

/** The payload `sendEvent` accepts for an event: its fields, scalar ones only. */
export type EmitPayload<P> = { [K in keyof P]: EmitValue<P[K]> };

/** Payload may be omitted when the event declares no required field. */
export type EmitArgs<P> =
  Record<never, never> extends P ? [payload?: EmitPayload<P>] : [payload: EmitPayload<P>];

/** Per-node push options. */
export interface PushOptions {
  /** Which devices get a copy: 'all' (the default) or only the most recently registered. */
  devices?: 'all' | 'latest';
}

/** `prefer()` options. */
export interface PreferOptions {
  /** The generated branch's name in IR (UI title / observability handle), as `branch(label, …)`. */
  label?: string;
}

/** The candidates `prefer()` takes: one push and one email template, in priority order. */
type PreferPair = readonly [PushTemplate, EmailTemplate] | readonly [EmailTemplate, PushTemplate];

type NormalizeProps<P> = { -readonly [K in keyof P]: P[K] };
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Both candidates render the one props object, so they must declare the same props type — not merely overlap. */
type SameProps<T extends PreferPair> =
  Equal<NormalizeProps<PropsOf<T[0]>>, NormalizeProps<PropsOf<T[1]>>> extends true
    ? unknown
    : { readonly __prefer_error__: 'Both templates must declare the same props type' };

/** Distributes, so a field only one member of a union variable has still counts as extra. */
type KeysOfUnion<A> = A extends unknown ? keyof A : never;
/** Rejects known extra fields, which `{}` (an empty props schema) would otherwise accept. */
type NoExtra<A, P> = Record<Exclude<KeysOfUnion<A>, keyof P>, never>;

/** prefer() is typed strictly, but a JS caller (or an `any`) reaches it unchecked — fail at the call, not at send time. */
function checkPreferArgs(candidates: unknown, props: unknown, options: unknown): void {
  if (!Array.isArray(candidates) || candidates.length !== 2) {
    throw new TypeError('prefer(): candidates must be exactly two templates — one push, one email');
  }
  const channels = (candidates as unknown[]).map((candidate) =>
    isTemplate(candidate) ? CHANNEL_OF[candidate.kind] : undefined
  );
  if (!channels.every((channel) => channel === 'push' || channel === 'email')) {
    throw new TypeError('prefer(): each candidate must be a pushTemplate or an emailTemplate');
  }
  if (channels[0] === channels[1]) {
    throw new TypeError('prefer(): candidates must be one push and one email template');
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new TypeError(
      'prefer(): props must be an object — pass {} when the templates declare none'
    );
  }
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('prefer(): options must be an object');
  }
  for (const [name, value] of Object.entries(options)) {
    if (name !== 'label') {
      throw new TypeError(
        `prefer(): unknown option '${name}' — props go in the second argument, options take only 'label'`
      );
    }
    if (typeof value !== 'string') throw new TypeError("prefer(): 'label' must be a string");
  }
}

/** A reusable flow fragment (what `flow(...)` returns), referenced directly by branch arms. */
export interface Flow {
  readonly __flow: true;
}

interface FlowInternal extends Flow {
  readonly nodes: NodeIR[];
  readonly uses: readonly TemplateUse[];
}

/**
 * @internal A template definition a flow sends, kept beside the IR (which names it by id only):
 * compileConfig checks that the registered definition under that id is this very object, so the
 * schema that typed the call is the one that renders it. Never part of the IR or its hash.
 */
export interface TemplateUse {
  readonly template: AnyTemplate;
  readonly loc: SourceLocIR | undefined;
}

/** @internal The template definitions a workflow sends, sub-flows and fragments included. */
export function templateUses(builder: FlowBuilder): readonly TemplateUse[] {
  return builder instanceof FlowBuilderImpl ? builder.uses : [];
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

/**
 * A cohort arm name has two jobs, and both constrain its spelling:
 * - it is interpolated into the node ids of the arm's flow ('{id}.{name}.{j}'),
 *   and an id is a durable step name — a dot would fake a nesting level and can
 *   collide with a real one, an empty name gives '{id}..{j}';
 * - it is an object key, and JavaScript lists integer-like keys first in
 *   ascending numeric order however the author wrote them. The arms array is
 *   documented (and interpreted) as authoring order, and the bucketing walk
 *   accumulates weights along it, so an arm named '0' added to a live
 *   experiment would prepend itself and re-bucket everyone already in it.
 */
const ARM_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A sub-flow's nodes; the template definitions it sends are added to `uses`. */
function resolveSubFlow(sub: SubFlow, uses: TemplateUse[]): NodeIR[] {
  if (typeof sub === 'function') {
    const builder = new FlowBuilderImpl();
    const returned: unknown = sub(builder);
    // An async callback would add its nodes after construction is over — after ids were assigned
    if (typeof (returned as { then?: unknown } | undefined)?.then === 'function') {
      throw new TypeError(
        'sub-flow callbacks must be synchronous: they run once, while the workflow is defined'
      );
    }
    uses.push(...builder.uses);
    return builder.nodes;
  }
  uses.push(...(sub as FlowInternal).uses);
  /*
   * A named fragment is a value, and the convention is to reuse it — two branch
   * arms may hold the same one. Handing out its own nodes aliases them into
   * both places, and assignIds writes ids *in place*: the second prefix
   * overwrites the first, so the two placements end up as one object under one
   * id — one durable step name, one message idempotency key, one bucket seed.
   * A copy per placement is what makes a fragment behave like a value.
   */
  return structuredClone((sub as FlowInternal).nodes);
}

export interface FlowBuilder {
  /* ---- Messages: every channel is one message node; separate methods buy channel-level typing ---- */
  email<T extends EmailTemplate>(template: T, ...props: MessageArgs<PropsOf<T>>): this;
  sms<P extends object>(template: TemplateRef<'sms', P>, ...props: MessageArgs<P>): this;
  /**
   * Push to the user's devices — every device the host's directory lists, or
   * only the most recently registered with `{ devices: 'latest' }`. A user with
   * no device is skipped (`prefer([pushTpl, emailTpl], props)` falls back to email).
   */
  push<T extends PushTemplate>(
    template: T,
    ...args: [...props: MessageArgs<PropsOf<T>>, options?: PushOptions]
  ): this;
  inApp<P extends object>(template: TemplateRef<'in_app', P>, ...props: MessageArgs<P>): this;
  slack<T extends SlackTemplate<PropsSchema, never>>(
    template: T,
    ...props: MessageArgs<PropsOf<T>>
  ): this;
  discord<T extends DiscordTemplate<PropsSchema, never>>(
    template: T,
    ...props: MessageArgs<PropsOf<T>>
  ): this;
  survey<P extends object>(template: TemplateRef<'survey', P>, ...props: MessageArgs<P>): this;

  /**
   * Send one message on the first channel the user can be reached on: one push
   * and one email template, in priority order, rendered with the same props.
   * Sugar for the branch it compiles to — same IR, ids and hash as writing
   *
   *   .branch(label, [reachable(first.channel), (b) => b.<first>(first, props)], (b) => b.<second>(second, props))
   *
   * so the choice is made once, when the step is reached, and a first choice
   * that fails to send retries as itself — it never falls through to the
   * second. Props are always passed (`{}` for templates that declare none),
   * and both templates must declare the same props type; for differing props
   * or other channels, write the branch.
   *
   *   .prefer([push.tip, email.tip], { name: u.name }, { label: 'tip by channel' })
   */
  prefer<const T extends PreferPair, const A extends PropsInput<NoInfer<PropsOf<T[0]>>>>(
    candidates: T & SameProps<NoInfer<T>>,
    props: A & NoInfer<NoExtra<A, PropsOf<T[0]>>>,
    options?: PreferOptions
  ): this;

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

  /**
   * Splice a fragment in place: a named `flow(...)` or a callback, expanded
   * once while the workflow is defined — a composition step before compiling,
   * not a node (the IR has no trace of it, and ids are assigned over the whole
   * workflow as if the steps were written inline). Each use gets its own copy,
   * so one fragment can be used in several places and workflows.
   *
   *   const officeHours = flow((w) => w.timeWindow({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], between: ['09:00', '17:00'] }));
   *   workflow({ id: 'onboarding', ... }).delay('1 day').use(officeHours).email(email.tip, { name: u.name })
   */
  use(fragment: SubFlow): this;

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
   * looping is a future re-entry-policy topic (see sendEvent). Arm labels in
   * the UI are derived from the condition.
   */
  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;

  /**
   * Gate: exit unless the condition holds, otherwise continue. A first-class
   * node rather than sugar over branch — same semantics as Zapier's "only
   * continue if" / Iterable's Filter tile, and rendered on its own in the UI.
   * `reason` is the audit-log line — metadata, so rewording it is free
   * (excluded from contentHash, see hash.ts).
   */
  filter(condition: Condition, opts?: { reason?: string }): this;

  /**
   * Random Cohort Branch (A/B): weights must sum to 100 (checked at runtime).
   * `key` names the experiment: bucketing hashes `userId:key` instead of the
   * structural node id, so assignments survive node insertion/moves and the
   * experiment keeps one identity across workflow versions — set it for any
   * A/B whose results you intend to read.
   *
   * Arm names become node id segments and are read back in authoring order, so
   * they are restricted to letters, digits, '_' and '-', never starting with a
   * digit (checked at runtime).
   */
  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>, opts?: { key?: string }): this;

  /**
   * Exit: end the whole workflow immediately (the UI's Exit node); `reason`
   * goes into the audit log and is metadata, so rewording it neither repins
   * in-flight journeys nor shows up in plan. Inside a branch arm this means
   * "terminate, do not rejoin" — it stops here instead of falling through,
   * while an arm without exit rejoins naturally.
   */
  exit(reason?: string): this;

  /* ---------------------------------- Data ---------------------------------- */
  /**
   * Emit a typed event (customer.io's Send Event). The event comes from an
   * e.xxx reference, so payload types flow in the same way trigger.event works.
   * This is how workflows compose: an event can trigger another workflow, and
   * the resulting call graph is statically analyzable. Payload values may
   * reference u.xxx. Only scalar fields can be sent (IR carries literals and
   * profile refs, not nested JSON): an event whose payload requires a nested
   * field cannot be emitted from a journey, and the types say so.
   *
   * Note on loops: a trailing self-triggering sendEvent will become the
   * official periodic-flow shape *once a re-entry policy exists* — today the
   * entry policy is once-per-user, so a self-trigger cannot re-enter and does
   * not loop.
   * TODO: the rest of the Data category — outbound webhook / profile update /
   * journey attributes.
   */
  sendEvent<P extends object>(event: EventRef<P>, ...payload: EmitArgs<P>): this;

  /**
   * Run a custom action (see dsl/action.ts for the model). The chain records
   * identity only — name, args, codeHash — never the code: the implementation
   * ships inside the deployed Worker bundle and is resolved by name from the
   * runtime registry. Args are typed by the ActionRef and may reference u.xxx,
   * resolved at run time exactly like message props. Executed inside a durable
   * step: retried on throw, checkpointed on success.
   */
  run<A extends object>(action: ActionRef<A>, ...args: MessageArgs<A>): this;
}

const DEFINED_CHANNELS: ReadonlySet<ChannelIR> = new Set(Object.values(CHANNEL_OF));

/** A message's template: a definition of the channel (named by its id), or a reference by key. */
type MessageTemplate = AnyTemplate | TemplateRef;

function templateKey(channel: ChannelIR, tpl: MessageTemplate): string {
  if (!DEFINED_CHANNELS.has(channel)) return (tpl as TemplateRef).key;
  // Typed, but a JS caller (or an `any`) reaches it unchecked: fail where the workflow is written
  if (!isTemplate(tpl) || CHANNEL_OF[tpl.kind] !== channel) {
    throw new TypeError(`${channel}(): expects a ${channel} template definition`);
  }
  return tpl.id;
}

function messageNode(
  channel: ChannelIR,
  tpl: MessageTemplate,
  props: object | undefined,
  devices?: 'latest'
): NodeIR {
  return {
    id: '',
    type: 'message',
    channel,
    template: templateKey(channel, tpl),
    props: (props ?? {}) as Record<string, PropValueIR>,
    // Absent for 'all', so adding the option left every existing push's hash as it was
    ...(devices !== undefined ? { devices } : {}),
  };
}

/* oxlint-disable typescript/unbound-method --
 * `captureLoc(this.xxx)` passes the method by identity as the stack-trace
 * boundary for Error.captureStackTrace; it is never invoked, so `this`
 * scoping cannot go wrong. */
/** @internal extended by WorkflowBuilderImpl; not part of the public API */
export class FlowBuilderImpl implements FlowBuilder {
  /** Nodes as collected; ids are assigned in one pass inside toIR, so '' is a placeholder here. */
  readonly nodes: NodeIR[] = [];
  /** The template definitions sent, with where: compile-time only, never in the IR. */
  readonly uses: TemplateUse[] = [];

  /** Provenance: the callsite (captured in the public method) lands in meta.loc, outside the hash. */
  private pushNode(node: NodeIR, loc: SourceLocIR | undefined): this {
    this.nodes.push({ ...node, ...(loc !== undefined ? { meta: { loc } } : {}) });
    return this;
  }

  private message(
    channel: ChannelIR,
    tpl: MessageTemplate,
    props: object | undefined,
    loc: SourceLocIR | undefined,
    devices?: 'latest'
  ): this {
    this.pushNode(messageNode(channel, tpl, props, devices), loc);
    if (isTemplate(tpl)) this.uses.push({ template: tpl, loc });
    return this;
  }

  email<T extends EmailTemplate>(t: T, ...args: MessageArgs<PropsOf<T>>): this {
    return this.message('email', t, args[0], captureLoc(this.email));
  }
  sms<P extends object>(t: TemplateRef<'sms', P>, ...args: MessageArgs<P>): this {
    return this.message('sms', t, args[0], captureLoc(this.sms));
  }
  push<T extends PushTemplate>(
    t: T,
    ...args: [...props: MessageArgs<PropsOf<T>>, options?: PushOptions]
  ): this {
    const [props, options] = args as unknown as [object | undefined, PushOptions | undefined];
    const devices = options?.devices === 'latest' ? 'latest' : undefined;
    return this.message('push', t, props, captureLoc(this.push), devices);
  }
  inApp<P extends object>(t: TemplateRef<'in_app', P>, ...args: MessageArgs<P>): this {
    return this.message('in_app', t, args[0], captureLoc(this.inApp));
  }
  slack<T extends SlackTemplate<PropsSchema, never>>(t: T, ...args: MessageArgs<PropsOf<T>>): this {
    return this.message('slack', t, args[0], captureLoc(this.slack));
  }
  discord<T extends DiscordTemplate<PropsSchema, never>>(
    t: T,
    ...args: MessageArgs<PropsOf<T>>
  ): this {
    return this.message('discord', t, args[0], captureLoc(this.discord));
  }
  survey<P extends object>(t: TemplateRef<'survey', P>, ...args: MessageArgs<P>): this {
    return this.message('survey', t, args[0], captureLoc(this.survey));
  }

  prefer<const T extends PreferPair, const A extends PropsInput<NoInfer<PropsOf<T[0]>>>>(
    candidates: T & SameProps<NoInfer<T>>,
    props: A & NoInfer<NoExtra<A, PropsOf<T[0]>>>,
    options?: PreferOptions
  ): this {
    checkPreferArgs(candidates, props, options);
    // Every generated node points at the author's prefer() call, not at this method's body
    const loc = captureLoc(this.prefer);
    const meta = loc !== undefined ? { meta: { loc } } : {};
    const [first, second] = candidates as readonly (EmailTemplate | PushTemplate)[];
    const channel = (tpl: EmailTemplate | PushTemplate) => CHANNEL_OF[tpl.kind] as 'email' | 'push';
    // Both are sent from here as far as the registry check goes, the fallback included
    this.uses.push({ template: first, loc }, { template: second, loc });
    // A copy per message, as two separately written calls would hold
    const arm = (tpl: EmailTemplate | PushTemplate): NodeIR[] => [
      { ...messageNode(channel(tpl), tpl, { ...props }), ...meta },
    ];
    return this.pushNode(
      {
        id: '',
        type: 'branch',
        ...(options?.label !== undefined ? { label: options.label } : {}),
        cases: [
          { condition: { type: 'reachable', channel: channel(first), ...meta }, flow: arm(first) },
        ],
        otherwise: arm(second),
      },
      loc
    );
  }

  delay(duration: Duration): this;
  delay(range: { min: Duration; max: Duration }): this;
  delay(d: Duration | { min: Duration; max: Duration }): this {
    const loc = captureLoc(this.delay);
    if (typeof d === 'string') {
      return this.pushNode({ id: '', type: 'delay', duration: durationIR(d) }, loc);
    }
    const min = durationIR(d.min);
    const max = durationIR(d.max);
    /*
     * The interpreter draws `min + random(max - min)` with the span clamped at
     * zero, so a backwards range does not fail — it quietly collapses into a
     * fixed `min` sleep. Reject it here, where the author can still see it.
     */
    if (max.ms < min.ms) {
      throw new Error(
        `delay(): 'max' must not be shorter than 'min', got { min: '${d.min}', max: '${d.max}' }`
      );
    }
    return this.pushNode({ id: '', type: 'random_delay', min, max }, loc);
  }

  timeWindow(opts: {
    days?: readonly Weekday[];
    between: readonly [TimeOfDay, TimeOfDay];
    tz?: 'user' | (string & {});
  }): this {
    const loc = captureLoc(this.timeWindow);
    const start = timeOfDayMinutes(opts.between[0]);
    const end = timeOfDayMinutes(opts.between[1]);
    if (end <= start) {
      throw new Error(
        `timeWindow(): 'between' must open before it closes within one day, got [${opts.between[0]}, ${opts.between[1]}] (overnight windows are not supported yet)`
      );
    }
    return this.pushNode(
      {
        id: '',
        type: 'time_window',
        days: [...(opts.days ?? (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const))],
        between: [opts.between[0], opts.between[1]],
        tz: opts.tz ?? 'user',
      },
      loc
    );
  }

  waitUntil(
    condition: Condition,
    opts: { timeout: Duration; onTimeout?: 'continue' | 'exit' | SubFlow }
  ): this {
    const loc = captureLoc(this.waitUntil);
    const onTimeout = opts.onTimeout ?? 'continue';
    return this.pushNode(
      {
        id: '',
        type: 'wait_until',
        condition: condIR(condition),
        timeout: durationIR(opts.timeout),
        onTimeout:
          onTimeout === 'continue' || onTimeout === 'exit'
            ? onTimeout
            : resolveSubFlow(onTimeout, this.uses),
      },
      loc
    );
  }

  use(fragment: SubFlow): this {
    // The fragment's nodes carry their own provenance (where the fragment was written)
    this.nodes.push(...resolveSubFlow(fragment, this.uses));
    return this;
  }

  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;
  branch(...args: readonly (string | BranchArm)[]): this {
    const loc = captureLoc(this.branch);
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
        cases.push({ condition: condIR(condition), flow: resolveSubFlow(sub, this.uses) });
      } else {
        if (otherwise !== undefined) {
          throw new Error('branch(): only one default arm (bare sub-flow) is allowed');
        }
        if (i !== arms.length - 1) {
          throw new Error('branch(): default arm (bare sub-flow) must be the last argument');
        }
        otherwise = resolveSubFlow(arm as SubFlow, this.uses);
      }
    });

    return this.pushNode(
      {
        id: '',
        type: 'branch',
        ...(label !== undefined ? { label } : {}),
        cases,
        ...(otherwise !== undefined ? { otherwise } : {}),
      },
      loc
    );
  }

  filter(condition: Condition, opts?: { reason?: string }): this {
    return this.pushNode(
      {
        id: '',
        type: 'filter',
        condition: condIR(condition),
        ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
      },
      captureLoc(this.filter)
    );
  }

  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>, opts?: { key?: string }): this {
    const loc = captureLoc(this.cohort);
    const entries = Object.entries(arms);
    /*
     * Weights live on a 0.01% grid: the runtime buckets into 10,000 slots
     * (basis points), so anything finer would be silently quantized — reject
     * it here instead. Converting to integer basis points also makes the
     * sum check exact; no epsilon needed.
     */
    const basisPoints = entries.map(([name, a]) => {
      if (!ARM_NAME.test(name)) {
        throw new Error(
          `cohort(): arm name '${name}' must start with a letter or '_' and contain only letters, digits, '_' or '-' — arm names become node id segments, and integer-like names would silently reorder the arms`
        );
      }
      const bp = a.weight * 100;
      if (Math.abs(bp - Math.round(bp)) > 1e-6) {
        throw new Error(
          `cohort(): arm '${name}' weight ${a.weight} is finer than the 0.01% bucketing grid — use at most two decimal places`
        );
      }
      /*
       * The sum check alone accepts -50 / 150: the runtime walks the arms
       * accumulating basis points and takes the first whose cumulative total
       * clears the bucket, so a negative weight hands 100% of users to its
       * neighbour instead of splitting anything.
       */
      if (bp < 0) {
        throw new Error(`cohort(): arm '${name}' weight ${a.weight} must not be negative`);
      }
      return Math.round(bp);
    });
    const total = basisPoints.reduce((sum, bp) => sum + bp, 0);
    if (total !== 10_000) {
      throw new Error(`cohort(): weights must sum to 100, got ${total / 100}`);
    }
    return this.pushNode(
      {
        id: '',
        type: 'cohort',
        ...(opts?.key !== undefined ? { key: opts.key } : {}),
        arms: entries.map(([name, a]) => ({
          name,
          weight: a.weight,
          flow: a.flow ? resolveSubFlow(a.flow, this.uses) : [],
        })),
      },
      loc
    );
  }

  exit(reason?: string): this {
    return this.pushNode(
      { id: '', type: 'exit', ...(reason !== undefined ? { reason } : {}) },
      captureLoc(this.exit)
    );
  }

  sendEvent<P extends object>(ev: EventRef<P>, ...payload: EmitArgs<P>): this {
    const values = (payload[0] ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(values)) {
      const ref =
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'user_property';
      if (!ref && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new TypeError(
          `sendEvent('${ev.name}'): '${field}' is not a scalar or a u.xxx reference — an emitted payload carries scalar fields only`
        );
      }
    }
    return this.pushNode(
      {
        id: '',
        type: 'send_event',
        event: ev.name,
        payload: values as Record<string, PropValueIR>,
      },
      captureLoc(this.sendEvent)
    );
  }

  run<A extends object>(a: ActionRef<A>, ...args: MessageArgs<A>): this {
    return this.pushNode(
      {
        id: '',
        type: 'action',
        action: a.name,
        args: (args[0] ?? {}) as Record<string, PropValueIR>,
        codeHash: a.codeHash,
      },
      captureLoc(this.run)
    );
  }
}
/* oxlint-enable typescript/unbound-method */

/**
 * A reusable flow fragment: a free function. Once personalization goes through
 * u.xxx and events through e.xxx, the flow layer carries no schema generics.
 */
export function flow(build: (w: FlowBuilder) => FlowBuilder): Flow {
  const builder = new FlowBuilderImpl();
  build(builder);
  const impl: FlowInternal = { __flow: true, nodes: builder.nodes, uses: builder.uses };
  return impl;
}
