import type { ChannelIR, ConditionIR, NodeIR, PropValueIR, SourceLocIR } from '../ir';
import { captureLoc } from '../provenance';
import { type Duration, type TimeOfDay, type Weekday, durationIR, timeOfDayMinutes } from './base';
import { type Condition, condIR } from './condition';
import type { EventRef, MessageArgs } from './refs';
import type { Channel, TemplateRef } from './template';

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
   * looping is a future re-entry-policy topic (see sendEvent). Arm labels in
   * the UI are derived from the condition.
   */
  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;

  /**
   * Gate: exit unless the condition holds, otherwise continue. A first-class
   * node rather than sugar over branch — same semantics as Zapier's "only
   * continue if" / Iterable's Filter tile, and rendered on its own in the UI.
   */
  filter(condition: Condition, opts?: { reason?: string }): this;

  /**
   * Random Cohort Branch (A/B): weights must sum to 100 (checked at runtime).
   * `key` names the experiment: bucketing hashes `userId:key` instead of the
   * structural node id, so assignments survive node insertion/moves and the
   * experiment keeps one identity across workflow versions — set it for any
   * A/B whose results you intend to read.
   */
  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>, opts?: { key?: string }): this;

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
   * the resulting call graph is statically analyzable. Payload values may
   * reference u.xxx.
   *
   * Note on loops: a trailing self-triggering sendEvent will become the
   * official periodic-flow shape *once a re-entry policy exists* — today the
   * entry policy is once-per-user, so a self-trigger cannot re-enter and does
   * not loop.
   * TODO: the rest of the Data category — outbound webhook / profile update /
   * journey attributes.
   */
  sendEvent<P extends object>(event: EventRef<P>, ...payload: MessageArgs<P>): this;
}

/* oxlint-disable typescript/unbound-method --
 * `captureLoc(this.xxx)` passes the method by identity as the stack-trace
 * boundary for Error.captureStackTrace; it is never invoked, so `this`
 * scoping cannot go wrong. */
/** @internal extended by WorkflowBuilderImpl; not part of the public API */
export class FlowBuilderImpl implements FlowBuilder {
  /** Nodes as collected; ids are assigned in one pass inside toIR, so '' is a placeholder here. */
  readonly nodes: NodeIR[] = [];

  /** Provenance: the callsite (captured in the public method) lands in meta.loc, outside the hash. */
  private pushNode(node: NodeIR, loc: SourceLocIR | undefined): this {
    this.nodes.push({ ...node, ...(loc !== undefined ? { meta: { loc } } : {}) });
    return this;
  }

  private message(
    channel: ChannelIR,
    tpl: TemplateRef<Channel, object>,
    props: object | undefined,
    loc: SourceLocIR | undefined
  ): this {
    return this.pushNode(
      {
        id: '',
        type: 'message',
        channel,
        template: tpl.key,
        props: (props ?? {}) as Record<string, PropValueIR>,
      },
      loc
    );
  }

  email<P extends object>(t: TemplateRef<'email', P>, ...args: MessageArgs<P>): this {
    return this.message('email', t, args[0], captureLoc(this.email));
  }
  sms<P extends object>(t: TemplateRef<'sms', P>, ...args: MessageArgs<P>): this {
    return this.message('sms', t, args[0], captureLoc(this.sms));
  }
  push<P extends object>(t: TemplateRef<'push', P>, ...args: MessageArgs<P>): this {
    return this.message('push', t, args[0], captureLoc(this.push));
  }
  inApp<P extends object>(t: TemplateRef<'in_app', P>, ...args: MessageArgs<P>): this {
    return this.message('in_app', t, args[0], captureLoc(this.inApp));
  }
  slack<P extends object>(t: TemplateRef<'slack', P>, ...args: MessageArgs<P>): this {
    return this.message('slack', t, args[0], captureLoc(this.slack));
  }
  survey<P extends object>(t: TemplateRef<'survey', P>, ...args: MessageArgs<P>): this {
    return this.message('survey', t, args[0], captureLoc(this.survey));
  }

  delay(duration: Duration): this;
  delay(range: { min: Duration; max: Duration }): this;
  delay(d: Duration | { min: Duration; max: Duration }): this {
    const loc = captureLoc(this.delay);
    if (typeof d === 'string') {
      return this.pushNode({ id: '', type: 'delay', duration: durationIR(d) }, loc);
    }
    return this.pushNode(
      {
        id: '',
        type: 'random_delay',
        min: durationIR(d.min),
        max: durationIR(d.max),
      },
      loc
    );
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
          onTimeout === 'continue' || onTimeout === 'exit' ? onTimeout : resolveSubFlow(onTimeout),
      },
      loc
    );
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
    const total = entries.reduce((sum, [, a]) => sum + a.weight, 0);
    // Epsilon comparison: fractional splits like 33.3/33.3/33.4 accumulate float error
    if (Math.abs(total - 100) > 1e-6) {
      throw new Error(`cohort(): weights must sum to 100, got ${total}`);
    }
    return this.pushNode(
      {
        id: '',
        type: 'cohort',
        ...(opts?.key !== undefined ? { key: opts.key } : {}),
        arms: entries.map(([name, a]) => ({
          name,
          weight: a.weight,
          flow: a.flow ? resolveSubFlow(a.flow) : [],
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

  sendEvent<P extends object>(ev: EventRef<P>, ...payload: MessageArgs<P>): this {
    return this.pushNode(
      {
        id: '',
        type: 'send_event',
        event: ev.name,
        payload: (payload[0] ?? {}) as Record<string, PropValueIR>,
      },
      captureLoc(this.sendEvent)
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
  const impl: FlowInternal = { __flow: true, nodes: builder.nodes };
  return impl;
}
