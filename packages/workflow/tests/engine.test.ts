import { describe, expect, test, vi } from 'vitest';
import { condIR } from '../src/dsl/condition';
import { hashToBucket, murmur3 } from '../src/engine/bucket';
import {
  type ActionInvocation,
  DEVICES_UPDATED_EVENT,
  type EngineStep,
  type FactSource,
  type JourneyContext,
  type OutboundMessage,
  PROFILE_UPDATED_EVENT,
  type PushDevice,
  RegistryActionInvoker,
  evaluateCondition,
  matchesWhere,
  relevantEvents,
  runJourney,
} from '../src/engine/index';
import { nextWindowStart } from '../src/engine/time-window';
import {
  type FlowBuilder,
  action,
  compileBundle,
  eq,
  performed,
  reachable,
  template,
  trigger,
  workflow,
} from '../src/index';
import type { ConditionIR, ScalarIR } from '../src/ir';
import {
  allSegments,
  checkoutRecovery,
  e,
  firstTimeRecovery,
  namedPush,
  nudge,
  plainEmail,
  proTips,
  reengagement,
  u,
  winback,
} from './fixtures';

/* ------------------------------ in-memory ports ------------------------------ */

class FakeStep implements EngineStep {
  readonly sleeps: { name: string; ms: number }[] = [];
  readonly stepNames: string[] = [];
  /** Event lists passed to subscribe, in call order. */
  readonly subscriptions: string[][] = [];
  /** Scripted waitForWake results, consumed in order; defaults to 'timeout'. */
  wakeScript: ('event' | 'timeout')[] = [];

  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.stepNames.push(name);
    return fn();
  }
  async sleep(name: string, ms: number): Promise<void> {
    this.sleeps.push({ name, ms });
  }
  async sleepUntil(name: string, timestampMs: number): Promise<void> {
    this.sleeps.push({ name, ms: timestampMs });
  }
  async subscribe(name: string, events: readonly string[]): Promise<void> {
    this.stepNames.push(name);
    this.subscriptions.push([...events]);
  }
  async unsubscribe(name: string): Promise<void> {
    this.stepNames.push(name);
  }
  async waitForWake(): Promise<'event' | 'timeout'> {
    return this.wakeScript.shift() ?? 'timeout';
  }
}

/** Segment definitions come from the compiled bundle — one source of truth with the fixtures. */
const SEGMENT_DEFS: Record<string, ConditionIR> = Object.fromEntries(
  compileBundle({ workflows: [], segments: allSegments }).segments.map((s) => [s.id, s.condition])
);

class FakeFacts implements FactSource {
  events: { name: string; ts: number; payload?: Record<string, unknown> }[] = [];
  props: Record<string, ScalarIR> = {};
  devices: PushDevice[] = [];

  async countEvents(
    event: string,
    opts?: { sinceMs?: number; untilMs?: number; where?: ConditionIR }
  ): Promise<number> {
    return this.events.filter(
      (e) =>
        e.name === event &&
        (opts?.sinceMs === undefined || e.ts >= opts.sinceMs) &&
        (opts?.untilMs === undefined || e.ts <= opts.untilMs) &&
        (opts?.where === undefined || matchesWhere(e.payload ?? {}, opts.where))
    ).length;
  }
  async getProperty(path: string): Promise<ScalarIR | undefined> {
    return this.props[path];
  }
  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    return SEGMENT_DEFS[name];
  }
  async listDevices(): Promise<PushDevice[]> {
    return this.devices;
  }
}

function makeContext() {
  const step = new FakeStep();
  const facts = new FakeFacts();
  const sent: OutboundMessage[] = [];
  const emitted: {
    event: string;
    payload: Record<string, ScalarIR | undefined>;
    id: string;
  }[] = [];
  const ctx: JourneyContext = {
    userId: 'u_1',
    instanceId: 'inst_1',
    enteredAtMs: Date.now(),
    step,
    facts,
    messages: {
      send: async (message) => {
        sent.push(message);
      },
    },
    events: {
      emit: async (event, payload, id) => {
        emitted.push({ event, payload, id });
      },
    },
  };
  return { ctx, step, facts, sent, emitted };
}

/* ---------------------------------- tests ---------------------------------- */

describe('runJourney: checkoutRecovery', () => {
  const ir = checkoutRecovery.toIR();

  test('non-subscriber takes the otherwise arm: n1 -> 23h -> n2', async () => {
    const { ctx, step, sent } = makeContext();

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.template)).toEqual([
      'n1_first_time_recovery',
      'n2_limited_time_offer',
    ]);
    expect(step.sleeps.map((s) => s.ms)).toEqual([3_600_000, 82_800_000]);
    expect(sent[1]?.props).toEqual({ coupon: '15OFF', expiresIn: '48 hours' });
  });

  test('active subscriber takes the case arm with personalized props', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.props = {
      email: 'user@example.com',
      subscription_status: 'active',
      auto_renew_enabled: true,
      subscription_plan: 'pro',
    };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.template)).toEqual(['u1_upgrade_recovery']);
    // the user_property ref resolves from the profile
    expect(sent[0]?.props).toEqual({ plan: 'pro' });
    // the recipient resolves from the channel's profile property
    expect(sent[0]?.recipient).toBe('user@example.com');
    expect(sent[0]?.idempotencyKey).toBe('inst_1:1.c0.0');
  });

  test('goal (purchase) met at a node boundary exits before sending', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: Date.now() });

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'goal', convertedAt: expect.any(Number) });
    expect(sent).toHaveLength(0);
  });
});

describe('runJourney: winback', () => {
  const ir = winback.toIR();

  test('business arm alerts CS then exits without rejoining', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.props = { subscription_plan: 'business' };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'exited', reason: 'handed_to_cs' });
    expect(sent.map((m) => m.channel)).toEqual(['slack']);
  });

  test('pro arm rejoins the shared tail (final offer)', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.props = { subscription_plan: 'pro' };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.template)).toEqual(['pro_tips', 'n2_limited_time_offer']);
  });
});

describe('runJourney: reengagement (wait_until)', () => {
  const ir = reengagement.toIR();

  test('wake with the condition met exits as reengaged', async () => {
    const { ctx, step, facts, sent } = makeContext();
    step.wakeScript = ['event'];
    // first check false, post-wake check true: the login lands in between
    let checks = 0;
    facts.countEvents = async (event: string) => {
      if (event !== 'login') return 0;
      checks += 1;
      return checks >= 2 ? 1 : 0;
    };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'exited', reason: 'reengaged' });
    expect(sent.map((m) => m.template)).toEqual(['n1_first_time_recovery']);
  });

  test('timeout continues the main line', async () => {
    const { ctx, sent } = makeContext();

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    // still-inactive users then hit the trailing A/B: the coupon arm may add one send
    expect(sent.slice(0, 2).map((m) => m.template)).toEqual(['n1_first_time_recovery', 'pro_tips']);
    expect(sent.slice(2).every((m) => m.template === 'n2_limited_time_offer')).toBe(true);
  });

  test('cohort bucketing is deterministic per user', async () => {
    const run = async (userId: string) => {
      const { ctx, sent } = makeContext();
      ctx.userId = userId;
      await runJourney(ir, ctx);
      return sent.some((m) => m.template === 'n2_limited_time_offer');
    };

    const first = await run('user_a');
    const second = await run('user_a');
    expect(first).toBe(second);

    // across many users both arms are used
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(`user_${i}`)));
    expect(new Set(results).size).toBe(2);
  });
});

describe('runJourney: send_event', () => {
  test('emits the event through the sink', async () => {
    const { ctx, emitted } = makeContext();

    const outcome = await runJourney(nudge.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' });
    /*
     * The id is the node's identity within this instance: the emit is wrapped
     * in a step, and a retried step body would otherwise write the event twice
     * into a log that count-based conditions read.
     */
    expect(emitted).toEqual([
      { event: 'nudge_due', payload: {}, id: expect.stringMatching(/^inst_1:/) },
    ]);
  });
});

describe('runJourney: action', () => {
  const sync = action<{ plan: string }>('sync_crm', async () => {});
  const wf = workflow({ id: 'with_action', trigger: trigger.event(e.sign_up) }).run(sync, {
    plan: u.subscription_plan,
  });

  test('invokes through the port with resolved args, code pin and idempotency key', async () => {
    const { ctx, step, facts } = makeContext();
    facts.props.subscription_plan = 'pro';
    const invoked: ActionInvocation[] = [];
    ctx.actions = {
      invoke: async (invocation) => {
        invoked.push(invocation);
      },
    };

    const outcome = await runJourney(wf.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(invoked).toEqual([
      {
        action: 'sync_crm',
        codeHash: sync.codeHash,
        args: { plan: 'pro' },
        userId: 'u_1',
        idempotencyKey: 'inst_1:0',
      },
    ]);
    expect(step.stepNames).toContain('0:run');
  });

  test('an action node without a configured invoker is a clear runtime error', async () => {
    const { ctx } = makeContext();
    await expect(runJourney(wf.toIR(), ctx)).rejects.toThrow(/no ActionInvoker configured/);
  });
});

describe('RegistryActionInvoker', () => {
  const base = {
    args: {},
    userId: 'u_1',
    idempotencyKey: 'inst_1:0',
  };

  test('runs the registered handler with args and user context', async () => {
    const calls: unknown[] = [];
    const invoker = new RegistryActionInvoker([
      {
        name: 'sync_crm',
        codeHash: 'h1',
        handler: async (args, ctx) => {
          calls.push([args, ctx]);
        },
      },
    ]);
    await invoker.invoke({ ...base, action: 'sync_crm', codeHash: 'h1', args: { plan: 'pro' } });
    expect(calls).toEqual([[{ plan: 'pro' }, { userId: 'u_1', idempotencyKey: 'inst_1:0' }]]);
  });

  test('the handler sees one idempotency key across a replayed step, so it can de-duplicate', async () => {
    // The registry holds no state of its own: only the handler can collapse
    // the second call a replayed step body makes, and only if it is given the key.
    const seen: string[] = [];
    const delivered = new Set<string>();
    const invoker = new RegistryActionInvoker([
      {
        name: 'grant_coupon',
        codeHash: 'h1',
        handler: async (_args, ctx) => {
          seen.push(ctx.idempotencyKey);
          delivered.add(ctx.idempotencyKey);
        },
      },
    ]);
    const invocation = { ...base, action: 'grant_coupon', codeHash: 'h1' };

    await invoker.invoke(invocation);
    await invoker.invoke(invocation); // the replay

    expect(seen).toEqual(['inst_1:0', 'inst_1:0']);
    expect(delivered.size).toBe(1);
  });

  test('an unregistered action fails the step', async () => {
    const invoker = new RegistryActionInvoker([]);
    await expect(invoker.invoke({ ...base, action: 'ghost' })).rejects.toThrow(/not registered/);
  });

  test('code skew warns by default and fails under strict', async () => {
    const entry = { name: 'sync_crm', codeHash: 'deployed', handler: async () => {} };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await new RegistryActionInvoker([entry]).invoke({
      ...base,
      action: 'sync_crm',
      codeHash: 'pinned',
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    await expect(
      new RegistryActionInvoker([entry], 'strict').invoke({
        ...base,
        action: 'sync_crm',
        codeHash: 'pinned',
      })
    ).rejects.toThrow(/differs from the version pinned/);
  });
});

describe('step naming', () => {
  test('step names derive from structural node ids', async () => {
    const { ctx, step } = makeContext();

    await runJourney(checkoutRecovery.toIR(), ctx);

    expect(step.stepNames).toContain('0:guard');
    expect(step.stepNames).toContain('1:eval');
    expect(step.stepNames).toContain('1.o.0:send');
  });
});

describe('waitUntil subscriptions', () => {
  test('a property-only condition subscribes to the profile-updated wake event', async () => {
    const propWait = workflow({ id: 'prop_wait', trigger: trigger.event(e.sign_up) }).waitUntil(
      eq(u.subscription_status, 'active'),
      { timeout: '1 hour' }
    );
    const { ctx, step } = makeContext();

    const outcome = await runJourney(propWait.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' }); // timeout -> continue
    expect(step.subscriptions).toEqual([[PROFILE_UPDATED_EVENT]]);
  });

  test('the subscription is registered before the first condition check', async () => {
    const waiter = workflow({ id: 'sub_order', trigger: trigger.event(e.sign_up) }).waitUntil(
      performed(e.login),
      { timeout: '1 hour' }
    );
    const { ctx, step } = makeContext();

    await runJourney(waiter.toIR(), ctx);

    // Re-armed per attempt (one subscribe = one wake-up), always before the check
    const subscribeAt = step.stepNames.indexOf('0:subscribe:0');
    const firstCheckAt = step.stepNames.indexOf('0:check:0');
    expect(subscribeAt).toBeGreaterThanOrEqual(0);
    expect(subscribeAt).toBeLessThan(firstCheckAt);
    expect(step.stepNames).toContain('0:unsubscribe');
  });
});

describe('goal attribution window (goal.within)', () => {
  const windowed = workflow({
    id: 'goal_window',
    trigger: trigger.event(e.begin_checkout),
    goal: { condition: performed(e.purchase), within: '1 hour' },
  }).email(firstTimeRecovery);

  test('a conversion inside the window exits as goal', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: Date.now() });

    const outcome = await runJourney(windowed.toIR(), ctx);

    expect(outcome).toEqual({ status: 'goal', convertedAt: expect.any(Number) });
    expect(sent).toHaveLength(0);
  });

  test('a conversion inside the window counts even when the check runs after it closed', async () => {
    const { ctx, facts } = makeContext();
    ctx.enteredAtMs = Date.now() - 7_200_000; // resumed two hours in, window is one hour
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 1_800_000 });

    const outcome = await runJourney(windowed.toIR(), ctx);

    // converted at the latest at the deadline: the check saw it only now
    expect(outcome).toEqual({ status: 'goal', convertedAt: ctx.enteredAtMs + 3_600_000 });
  });

  test('a purchase after the window closed is no conversion, whenever the check runs', async () => {
    const { ctx, facts, sent } = makeContext();
    ctx.enteredAtMs = Date.now() - 3_720_000; // 62 minutes in
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 3_660_000 }); // at minute 61

    const outcome = await runJourney(windowed.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });

  test('a conversion past the window no longer counts', async () => {
    const { ctx, facts, sent } = makeContext();
    ctx.enteredAtMs = Date.now() - 7_200_000; // entered two hours ago, window is one hour
    facts.events.push({ name: 'purchase', ts: Date.now() });

    const outcome = await runJourney(windowed.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });
});

describe('the conversion window outlives the flow', () => {
  const windowed = workflow({
    id: 'goal_tail',
    trigger: trigger.event(e.begin_checkout),
    goal: { condition: performed(e.purchase), within: '3 days' },
  }).email(firstTimeRecovery);

  test('a purchase after the last step, inside the window, is the conversion', async () => {
    const { ctx, facts, step, sent } = makeContext();
    step.waitForWake = async () => {
      facts.events.push({ name: 'purchase', ts: Date.now() });
      return 'event';
    };
    expect(await runJourney(windowed.toIR(), ctx)).toEqual({
      status: 'goal',
      convertedAt: expect.any(Number),
    });
    expect(sent).toHaveLength(1);
    expect(step.subscriptions.at(-1)).toEqual(['purchase']);
    expect(step.stepNames).toContain('goal:unsubscribe');
  });

  test('no purchase by the end of the window: completed', async () => {
    const { ctx, step } = makeContext();
    expect(await runJourney(windowed.toIR(), ctx)).toEqual({ status: 'completed' });
    expect(step.stepNames).toContain('goal:final');
  });

  test('a goal without a window ends with the flow', async () => {
    const { ctx, step } = makeContext();
    const open = workflow({
      id: 'goal_open',
      trigger: trigger.event(e.begin_checkout),
      goal: performed(e.purchase),
    }).email(firstTimeRecovery);
    expect(await runJourney(open.toIR(), ctx)).toEqual({ status: 'completed' });
    expect(step.stepNames.some((name) => name.startsWith('goal:'))).toBe(false);
  });
});

describe('conversion apart from the ending', () => {
  test('exitOnMatch: false keeps the flow going and ends completed, still converted', async () => {
    const wf = workflow({
      id: 'goal_keep_going',
      trigger: trigger.event(e.begin_checkout),
      goal: { condition: performed(e.purchase), exitOnMatch: false },
    }).email(firstTimeRecovery);
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 1 });

    const outcome = await runJourney(wf.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed', convertedAt: expect.any(Number) });
    expect(sent).toHaveLength(1);
  });

  test('exitWhen still ends the instance while it waits out the conversion window', async () => {
    const wf = workflow({
      id: 'goal_tail_exit',
      trigger: trigger.event(e.begin_checkout),
      goal: { condition: performed(e.purchase), within: '3 days' },
      exitWhen: performed(e.login),
    }).email(firstTimeRecovery);
    const { ctx, facts, step } = makeContext();
    step.waitForWake = async () => {
      facts.events.push({ name: 'login', ts: Date.now() });
      return 'event';
    };

    expect(await runJourney(wf.toIR(), ctx)).toEqual({ status: 'exit_when' });
    // armed for both: the goal's event and the exit's
    expect([...(step.subscriptions.at(-1) ?? [])].sort()).toEqual(['login', 'purchase']);
  });

  test('the instance is reported started before an entry guard can end it', async () => {
    const wf = workflow({
      id: 'goal_at_entry',
      trigger: trigger.event(e.begin_checkout),
      goal: performed(e.purchase),
    }).email(firstTimeRecovery);
    const { ctx, facts } = makeContext();
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 1 });
    const started: { instanceId: string; at: number }[] = [];
    ctx.observer = { started: async (event) => void started.push(event) };

    expect((await runJourney(wf.toIR(), ctx)).status).toBe('goal');
    expect(started).toEqual([
      expect.objectContaining({ instanceId: 'inst_1', at: ctx.enteredAtMs }),
    ]);
  });
});

describe('checkpoints written before conversions were recorded apart', () => {
  test('replay neither invents a conversion nor cuts a wait short', async () => {
    const wf = workflow({
      id: 'legacy_replay',
      trigger: trigger.event(e.begin_checkout),
      goal: { condition: performed(e.purchase), within: '3 days' },
    })
      .waitUntil(performed(e.login), { timeout: '1 day' })
      .email(firstTimeRecovery);
    const { ctx, step, sent } = makeContext();
    // What the old code checkpointed: the guard's booleans, a wait check's `false`
    const legacy: Record<string, unknown> = {
      'entry:guard': { goalMet: false, exitMet: false },
      '0:check:0': false,
    };
    step.do = async <T>(name: string, fn: () => Promise<T>): Promise<T> =>
      name in legacy ? (legacy[name] as T) : fn();
    step.wakeScript = ['timeout'];

    const outcome = await runJourney(wf.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });
});

describe('performed anchoring', () => {
  test('goal ignores events from before workflow entry', async () => {
    const wf = workflow({
      id: 'anchor_goal',
      trigger: trigger.event(e.begin_checkout),
      goal: performed(e.purchase),
    }).email(firstTimeRecovery);
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs - 60_000 });

    const outcome = await runJourney(wf.toIR(), ctx);

    // the pre-entry purchase is not a conversion of this journey
    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });

  test('goal counts events after entry', async () => {
    const wf = workflow({
      id: 'anchor_goal',
      trigger: trigger.event(e.begin_checkout),
      goal: performed(e.purchase),
    }).email(firstTimeRecovery);
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 1 });

    const outcome = await runJourney(wf.toIR(), ctx);

    expect(outcome).toEqual({ status: 'goal', convertedAt: expect.any(Number) });
    expect(sent).toHaveLength(0);
  });

  test('waitUntil ignores events from before the wait began', async () => {
    const wf = workflow({ id: 'anchor_wait', trigger: trigger.event(e.sign_up) }).waitUntil(
      performed(e.login),
      { timeout: '1 hour', onTimeout: 'exit' }
    );
    const { ctx, facts } = makeContext();
    facts.events.push({ name: 'login', ts: Date.now() - 60_000 });

    const outcome = await runJourney(wf.toIR(), ctx);

    // the pre-existing login does not satisfy the wait; the timeout path exits
    expect(outcome).toEqual({ status: 'exited', reason: '0:timeout' });
  });
});

describe('payload where clauses', () => {
  test('matchesWhere: nested paths, combinators, existence, comparisons', () => {
    const where: ConditionIR = {
      type: 'and',
      conditions: [
        { type: 'payload', path: 'platform', op: 'eq', value: 'web' },
        { type: 'payload', path: 'tags.utm_source', op: 'eq', value: 'meta' },
      ],
    };
    expect(matchesWhere({ platform: 'web', tags: { utm_source: 'meta' } }, where)).toBe(true);
    expect(matchesWhere({ platform: 'ios', tags: { utm_source: 'meta' } }, where)).toBe(false);
    expect(matchesWhere({ platform: 'web' }, where)).toBe(false);

    expect(matchesWhere({}, { type: 'payload', path: 'tags', op: 'exists' })).toBe(false);
    expect(matchesWhere({ tags: {} }, { type: 'payload', path: 'tags', op: 'exists' })).toBe(true);
    expect(
      matchesWhere({ value: 50 }, { type: 'payload', path: 'value', op: 'gt', value: 30 })
    ).toBe(true);
    expect(
      matchesWhere(
        { platform: 'ios' },
        { type: 'not', condition: { type: 'payload', path: 'platform', op: 'eq', value: 'web' } }
      )
    ).toBe(true);
  });

  test('performed({ where }) counts only matching events', async () => {
    const facts = new FakeFacts();
    facts.events.push(
      { name: 'sign_up', ts: 1, payload: { method: 'email' } },
      { name: 'sign_up', ts: 2, payload: { method: 'google' } }
    );
    const googleSignup: ConditionIR = {
      type: 'performed',
      event: 'sign_up',
      where: { type: 'payload', path: 'method', op: 'eq', value: 'google' },
    };

    await expect(evaluateCondition(googleSignup, facts, 10)).resolves.toBe(true);
    await expect(evaluateCondition({ ...googleSignup, count: 2 }, facts, 10)).resolves.toBe(false);
  });
});

describe('guards run at entry and suspension points only', () => {
  test('synchronous nodes get no per-node guard', async () => {
    const wf = workflow({
      id: 'guarded',
      trigger: trigger.event(e.sign_up),
      goal: performed(e.purchase),
    })
      .email(firstTimeRecovery)
      .delay('1 hour')
      .email(proTips);
    const { ctx, step } = makeContext();

    await runJourney(wf.toIR(), ctx);

    const guards = step.stepNames.filter((name) => name.endsWith(':guard'));
    expect(guards).toEqual(['entry:guard', '1:guard']);
  });
});

describe('cohort experiment key', () => {
  const couponArm = {
    control: { weight: 50 },
    coupon: { weight: 50, flow: (x: FlowBuilder) => x.email(proTips) },
  };

  const armOf = async (builder: ReturnType<typeof workflow>, userId: string) => {
    const { ctx, sent } = makeContext();
    ctx.userId = userId;
    await runJourney(builder.toIR(), ctx);
    return sent.some((m) => m.template === 'pro_tips');
  };

  test('with a key, assignment survives node position changes', async () => {
    const atHead = workflow({ id: 'ab_head', trigger: trigger.event(e.sign_up) }).cohort(
      couponArm,
      {
        key: 'exp1',
      }
    );
    const shifted = workflow({ id: 'ab_shifted', trigger: trigger.event(e.sign_up) })
      .email(firstTimeRecovery)
      .cohort(couponArm, { key: 'exp1' });

    for (let i = 0; i < 25; i++) {
      expect(await armOf(atHead, `user_${i}`)).toBe(await armOf(shifted, `user_${i}`));
    }
  });

  test('without a key, position shifts reshuffle assignments (the reason key exists)', async () => {
    const atHead = workflow({ id: 'ab_head', trigger: trigger.event(e.sign_up) }).cohort(couponArm);
    const shifted = workflow({ id: 'ab_shifted', trigger: trigger.event(e.sign_up) })
      .email(firstTimeRecovery)
      .cohort(couponArm);

    let diverged = 0;
    for (let i = 0; i < 25; i++) {
      if ((await armOf(atHead, `user_${i}`)) !== (await armOf(shifted, `user_${i}`))) diverged++;
    }
    expect(diverged).toBeGreaterThan(0);
  });
});

describe('replay determinism', () => {
  class RecordingStep extends FakeStep {
    readonly results = new Map<string, unknown>();
    readonly wakeOutcomes: ('event' | 'timeout')[] = [];

    override async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
      this.stepNames.push(name);
      const result = await fn();
      this.results.set(name, result);
      return result;
    }
    override async waitForWake(): Promise<'event' | 'timeout'> {
      const outcome = this.wakeScript.shift() ?? 'timeout';
      this.wakeOutcomes.push(outcome);
      return outcome;
    }
  }

  class ReplayStep extends FakeStep {
    constructor(
      private readonly results: Map<string, unknown>,
      wakes: ('event' | 'timeout')[]
    ) {
      super();
      this.wakeScript = [...wakes];
    }
    override async do<T>(name: string, _fn: () => Promise<T>): Promise<T> {
      this.stepNames.push(name);
      if (!this.results.has(name)) {
        throw new Error(`replay requested unrecorded step '${name}' — step sequence diverged`);
      }
      return this.results.get(name) as T;
    }
  }

  test('replaying cached step results a month later yields the identical step sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-16T00:00:00Z') });
    try {
      const ir = reengagement.toIR();

      const recordingStep = new RecordingStep();
      recordingStep.wakeScript = ['event'];
      const first = makeContext();
      first.ctx.step = recordingStep;
      const firstOutcome = await runJourney(ir, first.ctx);

      // Replay far in the future: any control flow leaking uncheckpointed
      // wall-clock time would take a different branch and diverge.
      vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
      const replayStep = new ReplayStep(recordingStep.results, recordingStep.wakeOutcomes);
      const second = makeContext();
      second.ctx.step = replayStep;
      second.ctx.enteredAtMs = first.ctx.enteredAtMs;
      const secondOutcome = await runJourney(ir, second.ctx);

      expect(replayStep.stepNames).toEqual(recordingStep.stepNames);
      expect(secondOutcome).toEqual(firstOutcome);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('nextWindowStart: time windows honor end times and timezones', () => {
  const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const between = ['09:00', '17:00'] as const;
  // Wednesday 2026-08-12, instants in UTC
  const wedMorning = Date.UTC(2026, 7, 12, 8, 0);
  const wedNoon = Date.UTC(2026, 7, 12, 12, 0);
  const wedNight = Date.UTC(2026, 7, 12, 23, 0);

  test('inside the window: no wait', () => {
    expect(nextWindowStart(wedNoon, allDays, between, 'UTC')).toBeNull();
  });

  test("before today's window: today's start", () => {
    expect(nextWindowStart(wedMorning, allDays, between, 'UTC')).toBe(Date.UTC(2026, 7, 12, 9, 0));
  });

  test("after the window closes: tomorrow's start, never 'send now'", () => {
    expect(nextWindowStart(wedNight, allDays, between, 'UTC')).toBe(Date.UTC(2026, 7, 13, 9, 0));
  });

  test('day filtering skips to the next allowed weekday', () => {
    expect(nextWindowStart(wedNight, ['mon'], between, 'UTC')).toBe(Date.UTC(2026, 7, 17, 9, 0));
  });

  test('timezone shifts the window (09:00 in Shanghai is 01:00 UTC)', () => {
    expect(nextWindowStart(wedNight, allDays, between, 'Asia/Shanghai')).toBe(
      Date.UTC(2026, 7, 13, 1, 0)
    );
  });

  test('an unknown timezone falls back to UTC instead of wedging the journey', () => {
    expect(nextWindowStart(wedNight, allDays, between, 'Not/AZone')).toBe(
      Date.UTC(2026, 7, 13, 9, 0)
    );
  });
});

describe('nextWindowStart: daylight-saving transitions', () => {
  /*
   * America/New_York springs forward on Sunday 2026-03-08: 02:00 EST becomes
   * 03:00 EDT, so that local day is 23 hours long and 02:00–02:59 never
   * happens. UTC and Asia/Shanghai cannot exercise either edge.
   */
  const NY = 'America/New_York';

  test('the scan visits a 23-hour local day instead of stepping over it', () => {
    // Saturday 2026-03-07 23:30 EST, waiting for Sunday's window
    const eve = Date.UTC(2026, 2, 8, 4, 30);

    const next = nextWindowStart(eve, ['sun'], ['09:00', '17:00'], NY);

    // Sunday 2026-03-08 09:00 EDT — stepping the absolute clock by 24h landed
    // on Monday and held the send for the following Sunday instead
    expect(next).toBe(Date.UTC(2026, 2, 8, 13, 0));
  });

  test('a start inside the spring-forward gap opens at the first instant that exists', () => {
    // Sunday 2026-03-08 00:45 EST; 02:30 local is skipped by the transition
    const beforeGap = Date.UTC(2026, 2, 8, 5, 45);

    const next = nextWindowStart(beforeGap, ['sun'], ['02:30', '17:00'], NY);

    // 03:00 EDT, not 01:30 EST: a window may open late, never before its start
    expect(next).toBe(Date.UTC(2026, 2, 8, 7, 0));
  });

  test('a start repeated by the fall-back opens at its first occurrence', () => {
    // Sunday 2026-11-01 00:30 EDT; 01:30 local happens twice that morning
    const beforeFallBack = Date.UTC(2026, 10, 1, 4, 30);

    const next = nextWindowStart(beforeFallBack, ['sun'], ['01:30', '03:00'], NY);

    expect(next).toBe(Date.UTC(2026, 10, 1, 5, 30)); // 01:30 EDT, the earlier one
  });
});

describe('murmur3 bucketing', () => {
  /*
   * Known-answer vectors for MurmurHash3 x86 32-bit, seed 0 — shared across
   * reference implementations. The bucket function is a permanent contract
   * (changing it reshuffles every in-flight cohort), so these pin the
   * implementation, not just its behaviour.
   */
  test('matches the reference vectors (seed 0)', () => {
    const utf8 = new TextEncoder();
    expect(murmur3(utf8.encode(''))).toBe(0);
    expect(murmur3(utf8.encode('a'))).toBe(0x3c2569b2);
    expect(murmur3(utf8.encode('abc'))).toBe(0xb3dd93fa);
    expect(murmur3(utf8.encode('hello'))).toBe(0x248bfa47);
    expect(murmur3(utf8.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x2e4ff723);
  });

  test('a custom seed changes the hash', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(murmur3(bytes, 1)).not.toBe(murmur3(bytes, 0));
  });

  test('buckets are stable, on the basis-point grid, and use every remainder length', () => {
    // Keys of length % 4 = 0..3 exercise all tail branches
    for (const key of ['u_12:3', 'u_123:3', 'u_1:3', 'u_12345:3.c0.1']) {
      const bucket = hashToBucket(key);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(10_000);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(hashToBucket(key)).toBe(bucket);
    }
  });

  test('sequential user ids spread across buckets', () => {
    const buckets = new Set(
      Array.from({ length: 200 }, (_, i) => hashToBucket(`user_${i}:node_3`))
    );
    // 200 sequential keys over 10,000 buckets: collisions should be rare
    expect(buckets.size).toBeGreaterThan(180);
  });

  test('fractional weights are honoured at basis-point precision', async () => {
    // A 0.5% arm: exactly buckets 0..49 of 10,000 — impossible on a 100-bucket grid
    const ab = workflow({ id: 'bp_split', trigger: trigger.event(e.login) }).cohort(
      { tiny: { weight: 0.5, flow: (w: FlowBuilder) => w.email(proTips) }, rest: { weight: 99.5 } },
      { key: 'bp_probe' }
    );
    const ir = ab.toIR();

    let tiny = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const { ctx, sent } = makeContext();
      ctx.userId = `user_${i}`;
      await runJourney(ir, ctx);
      if (sent.length > 0) tiny += 1;
    }
    // Expectation 20 of 4000 (0.5%); allow generous sampling noise, but a
    // 100-bucket quantization would land on 0 or ~40 — both outside this band
    expect(tiny).toBeGreaterThan(4);
    expect(tiny).toBeLessThan(60);
  });
});

describe('evaluateCondition: comparison operators', () => {
  const evalWith = (condition: ConditionIR, props: Record<string, ScalarIR>) => {
    const facts = new FakeFacts();
    facts.props = props;
    return evaluateCondition(condition, facts, 0);
  };
  const docsCount = (op: 'gt' | 'gte' | 'lt' | 'lte', value: number): ConditionIR => ({
    type: 'property',
    path: 'docs_count',
    op,
    value,
  });

  test('gte and lte include the boundary; gt and lt exclude it', async () => {
    await expect(evalWith(docsCount('gt', 10), { docs_count: 10 })).resolves.toBe(false);
    await expect(evalWith(docsCount('gte', 10), { docs_count: 10 })).resolves.toBe(true);
    await expect(evalWith(docsCount('lt', 10), { docs_count: 10 })).resolves.toBe(false);
    await expect(evalWith(docsCount('lte', 10), { docs_count: 10 })).resolves.toBe(true);
    await expect(evalWith(docsCount('gte', 10), { docs_count: 11 })).resolves.toBe(true);
    await expect(evalWith(docsCount('lte', 10), { docs_count: 9 })).resolves.toBe(true);
  });

  test('gte and lte on a missing property are false', async () => {
    await expect(evalWith(docsCount('gte', 0), {})).resolves.toBe(false);
    await expect(evalWith(docsCount('lte', 0), {})).resolves.toBe(false);
  });

  test('not_between excludes the inclusive range and treats a missing property as outside', async () => {
    const cond: ConditionIR = {
      type: 'property',
      path: 'docs_count',
      op: 'not_between',
      values: [1, 9],
    };
    await expect(evalWith(cond, { docs_count: 5 })).resolves.toBe(false);
    await expect(evalWith(cond, { docs_count: 1 })).resolves.toBe(false);
    await expect(evalWith(cond, { docs_count: 9 })).resolves.toBe(false);
    await expect(evalWith(cond, { docs_count: 10 })).resolves.toBe(true);
    await expect(evalWith(cond, {})).resolves.toBe(true);
  });
});

describe('segment cycles in hand-built IR', () => {
  /*
   * `segment(...)` is an eager constructor, so a cycle cannot be written in the
   * DSL — but IR is read back from KV and segment definitions from D1, where a
   * self-reference is just a row. Unbounded recursion is the worst failure
   * shape available here: it blows the stack inside a durable step, the step
   * throws, Workflows retries it, and the instance is wedged for good — after
   * one D1 round trip per level of recursion.
   */
  const definitions: Record<string, ConditionIR> = {
    loops: { type: 'segment', segment: 'loops' },
    ping: {
      type: 'and',
      conditions: [
        { type: 'performed', event: 'login' },
        { type: 'segment', segment: 'pong' },
      ],
    },
    pong: { type: 'segment', segment: 'ping' },
    active: { type: 'performed', event: 'login' },
  };

  /** Records every definition read, so "bounded" can be asserted and not just assumed. */
  function trackingFacts() {
    const lookups: string[] = [];
    const facts: FactSource = {
      countEvents: async () => 1,
      getProperty: async () => undefined,
      getSegmentCondition: async (name) => {
        lookups.push(name);
        return definitions[name];
      },
      listDevices: async () => [],
    };
    return { facts, lookups };
  }

  const ref = (segment: string): ConditionIR => ({ type: 'segment', segment });

  test('a self-referencing segment reports the cycle instead of exhausting the stack', async () => {
    const { facts, lookups } = trackingFacts();

    await expect(evaluateCondition(ref('loops'), facts, 0)).rejects.toThrow(
      "segment 'loops' references itself: loops -> loops"
    );
    expect(lookups).toEqual(['loops']); // one read, not one per level of recursion
  });

  test('a cycle closed through a second segment is caught on the same path', async () => {
    const { facts } = trackingFacts();

    await expect(evaluateCondition(ref('ping'), facts, 0)).rejects.toThrow(
      "segment 'ping' references itself: ping -> pong -> ping"
    );
  });

  test('the same segment reached down two branches is a diamond, not a cycle', async () => {
    const { facts } = trackingFacts();
    const diamond: ConditionIR = { type: 'and', conditions: [ref('active'), ref('active')] };

    await expect(evaluateCondition(diamond, facts, 0)).resolves.toBe(true);
  });

  test('relevantEvents expands each segment once, so a cycle terminates', async () => {
    const { facts, lookups } = trackingFacts();

    await expect(relevantEvents(ref('ping'), facts)).resolves.toEqual(['login']);
    expect(lookups).toEqual(['ping', 'pong']);
  });
});

describe('push goes to devices', () => {
  const ping = namedPush('ping');
  const phone: PushDevice = { token: 'tok-phone', platform: 'ios' };
  const tablet: PushDevice = { token: 'tok-tablet', platform: 'android' };

  test('one copy per listed device, each keyed by its token', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.devices = [phone, tablet];
    const ir = workflow({ id: 'push_all', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .toIR();
    await runJourney(ir, ctx);
    expect(sent.map((m) => [m.recipient, m.device?.platform, m.idempotencyKey])).toEqual([
      ['tok-phone', 'ios', 'inst_1:0:tok-phone'],
      ['tok-tablet', 'android', 'inst_1:0:tok-tablet'],
    ]);
  });

  test('a failure on one device retries that device alone', async () => {
    const { ctx, facts, step, sent } = makeContext();
    facts.devices = [phone, tablet];
    // A durable step: a completed one replays its result; a failed one runs again on retry
    const done = new Map<string, unknown>();
    step.do = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      if (done.has(name)) return done.get(name) as T;
      const result = await fn();
      done.set(name, result);
      return result;
    };
    let tabletDown = true;
    ctx.messages = {
      send: async (message) => {
        if (message.recipient === 'tok-tablet' && tabletDown) throw new Error('FCM 503');
        sent.push(message);
      },
    };
    const ir = workflow({ id: 'push_retry', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .toIR();

    await expect(runJourney(ir, ctx)).rejects.toThrow('FCM 503');
    tabletDown = false;
    await runJourney(ir, ctx);

    // The phone got its copy once; the retry only reached the tablet
    expect(sent.map((m) => m.recipient)).toEqual(['tok-phone', 'tok-tablet']);
  });

  test("devices: 'latest' only reaches the most recently registered device", async () => {
    const { ctx, facts, sent } = makeContext();
    facts.devices = [tablet, phone];
    const ir = workflow({ id: 'push_latest', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email }, { devices: 'latest' })
      .toIR();
    expect(ir.flow[0]).toMatchObject({ type: 'message', devices: 'latest' });
    await runJourney(ir, ctx);
    expect(sent.map((m) => m.recipient)).toEqual(['tok-tablet']);
  });

  test('the default leaves no devices field, so existing pushes keep their hash', () => {
    const ir = workflow({ id: 'push_default', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email }, { devices: 'all' })
      .toIR();
    expect(ir.flow[0]).not.toHaveProperty('devices');
  });

  test('a user without a device is skipped and the journey goes on', async () => {
    const { ctx, sent } = makeContext();
    const ir = workflow({ id: 'push_none', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .delay('1 hour')
      .toIR();
    expect(await runJourney(ir, ctx)).toEqual({ status: 'completed' });
    expect(sent).toEqual([]);
  });

  test("reachable('push') asks the device directory and wakes on device changes", async () => {
    const facts = new FakeFacts();
    const condition = condIR(reachable('push'));
    expect(await evaluateCondition(condition, facts, Date.now())).toBe(false);
    facts.devices = [phone];
    expect(await evaluateCondition(condition, facts, Date.now())).toBe(true);
    expect(await relevantEvents(condition, facts)).toEqual([DEVICES_UPDATED_EVENT]);
  });

  test("reachable('email') is the recipient property being set", async () => {
    const facts = new FakeFacts();
    const condition = condIR(reachable('email'));
    expect(await evaluateCondition(condition, facts, Date.now())).toBe(false);
    facts.props.email = 'ada@acme.test';
    expect(await evaluateCondition(condition, facts, Date.now())).toBe(true);
    expect(await relevantEvents(condition, facts)).toEqual([PROFILE_UPDATED_EVENT]);
  });
});

describe('template validation before sending', () => {
  const ping = namedPush('ping');

  test('a refused push reaches no device, and the error names the instance and node', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.devices = [
      { token: 'a', platform: 'ios' },
      { token: 'b', platform: 'android' },
    ];
    ctx.validator = {
      validate: () => {
        throw Object.assign(new Error("push template 'ping' rejected its props: name required"), {
          name: 'TemplateValidationError',
        });
      },
    };
    const ir = workflow({ id: 'validated', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .toIR();
    const error = await runJourney(ir, ctx).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'TemplateValidationError' });
    expect((error as Error).message).toMatch(/^\[inst_1 0\] push template 'ping'/);
    expect(sent).toEqual([]);
  });

  test('senders get the parsed props the validator returns', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.devices = [{ token: 'a', platform: 'ios' }];
    facts.props.email = 'ada@acme.test';
    ctx.validator = { validate: ({ props }) => ({ name: `parsed:${String(props.name)}` }) };
    const ir = workflow({ id: 'validated_ok', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .toIR();
    await runJourney(ir, ctx);
    expect(sent.map((m) => m.props)).toEqual([{ name: 'parsed:ada@acme.test' }]);
  });
});

describe('the observer hears positions and copies', () => {
  const ping = namedPush('ping');
  const hello = plainEmail('hello');

  test('each node is reported once, in its own step, with the workflow and instance', async () => {
    const { ctx, step } = makeContext();
    const reached: string[] = [];
    ctx.observer = {
      nodeReached: async ({ workflow: name, instanceId, nodeId }) => {
        reached.push(`${name}/${instanceId}/${nodeId}`);
      },
    };
    const ir = workflow({ id: 'observed', trigger: trigger.event(e.login) })
      .email(hello)
      .delay('1 hour')
      .toIR();
    await runJourney(ir, ctx);
    expect(reached).toEqual(['observed/inst_1/0', 'observed/inst_1/1']);
    expect(step.stepNames.filter((name) => name.endsWith(':reached'))).toEqual([
      '0:reached',
      '1:reached',
    ]);
  });

  test('no observer, no extra steps', async () => {
    const { ctx, step } = makeContext();
    const ir = workflow({ id: 'plain', trigger: trigger.event(e.login) })
      .email(hello)
      .toIR();
    await runJourney(ir, ctx);
    expect(step.stepNames.some((name) => name.endsWith(':reached'))).toBe(false);
  });

  test('tracking from messagePrepared reaches the sender; messageSent hears the result per copy', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.devices = [
      { token: 'tok-live', platform: 'ios' },
      { token: 'tok-dead', platform: 'ios' },
    ];
    ctx.messages = {
      send: async (message) => {
        sent.push(message);
        return message.recipient === 'tok-dead'
          ? { delivered: false, reason: 'Unregistered' }
          : undefined;
      },
    };
    const results: [string, unknown][] = [];
    ctx.observer = {
      messagePrepared: async (message) => ({ data: { message_id: `m:${message.idempotencyKey}` } }),
      messageSent: async (message, result) => {
        results.push([message.idempotencyKey, result]);
      },
    };
    const ir = workflow({ id: 'pushed', trigger: trigger.event(e.login) })
      .push(ping, { name: u.email })
      .toIR();
    await runJourney(ir, ctx);
    expect(sent.map((m) => [m.workflow, m.nodeId, m.tracking?.data])).toEqual([
      ['pushed', '0', { message_id: 'm:inst_1:0:tok-live' }],
      ['pushed', '0', { message_id: 'm:inst_1:0:tok-dead' }],
    ]);
    expect(results).toEqual([
      ['inst_1:0:tok-live', { delivered: true }],
      ['inst_1:0:tok-dead', { delivered: false, reason: 'Unregistered' }],
    ]);
  });

  test('a send that throws is not reported as sent', async () => {
    const { ctx } = makeContext();
    ctx.messages = {
      send: async () => {
        throw new Error('transport down');
      },
    };
    const sentReports: string[] = [];
    ctx.observer = { messageSent: async (m) => void sentReports.push(m.idempotencyKey) };
    const ir = workflow({ id: 'failing', trigger: trigger.event(e.login) })
      .email(hello)
      .toIR();
    await expect(runJourney(ir, ctx)).rejects.toThrow('transport down');
    expect(sentReports).toEqual([]);
  });

  test('a report that fails after the send does not fail the step (no second send)', async () => {
    const { ctx, sent } = makeContext();
    ctx.observer = {
      messageSent: async () => {
        throw new Error('reporting database down');
      },
    };
    const ir = workflow({ id: 'reporting_down', trigger: trigger.event(e.login) })
      .email(hello)
      .toIR();
    await expect(runJourney(ir, ctx)).resolves.toMatchObject({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });
});
