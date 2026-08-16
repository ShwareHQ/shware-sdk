import { describe, expect, test, vi } from 'vitest';
import { hashToBucket, murmur3 } from '../src/engine/bucket';
import {
  type EngineStep,
  type FactSource,
  type JourneyContext,
  type OutboundMessage,
  PROFILE_UPDATED_EVENT,
  evaluateCondition,
  fillSubject,
  matchesWhere,
  runJourney,
} from '../src/engine/index';
import { nextWindowStart } from '../src/engine/time-window';
import { type FlowBuilder, compileBundle, eq, performed, trigger, workflow } from '../src/index';
import type { ConditionIR, ScalarIR } from '../src/ir';
import {
  allSegments,
  checkoutRecovery,
  e,
  firstTimeRecovery,
  nudge,
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
  compileBundle({ workflows: [], segments: allSegments }).segments.map((s) => [s.name, s.condition])
);

class FakeFacts implements FactSource {
  events: { name: string; ts: number; payload?: Record<string, unknown> }[] = [];
  props: Record<string, ScalarIR> = {};

  async countEvents(
    event: string,
    opts?: { sinceMs?: number; where?: ConditionIR }
  ): Promise<number> {
    return this.events.filter(
      (e) =>
        e.name === event &&
        (opts?.sinceMs === undefined || e.ts >= opts.sinceMs) &&
        (opts?.where === undefined || matchesWhere(e.payload ?? {}, opts.where))
    ).length;
  }
  async getProperty(path: string): Promise<ScalarIR | undefined> {
    return this.props[path];
  }
  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    return SEGMENT_DEFS[name];
  }
}

function makeContext() {
  const step = new FakeStep();
  const facts = new FakeFacts();
  const sent: OutboundMessage[] = [];
  const emitted: { event: string; payload: Record<string, ScalarIR | undefined> }[] = [];
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
      emit: async (event, payload) => {
        emitted.push({ event, payload });
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

    expect(outcome).toEqual({ status: 'goal' });
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
    expect(emitted).toEqual([{ event: 'nudge_due', payload: {} }]);
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
    const propWait = workflow('prop_wait', { trigger: trigger.event(e.sign_up) }).waitUntil(
      eq(u.subscription_status, 'active'),
      { timeout: '1 hour' }
    );
    const { ctx, step } = makeContext();

    const outcome = await runJourney(propWait.toIR(), ctx);

    expect(outcome).toEqual({ status: 'completed' }); // timeout -> continue
    expect(step.subscriptions).toEqual([[PROFILE_UPDATED_EVENT]]);
  });

  test('the subscription is registered before the first condition check', async () => {
    const waiter = workflow('sub_order', { trigger: trigger.event(e.sign_up) }).waitUntil(
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
  const windowed = workflow('goal_window', {
    trigger: trigger.event(e.begin_checkout),
    goal: { condition: performed(e.purchase), within: '1 hour' },
  }).email(firstTimeRecovery);

  test('a conversion inside the window exits as goal', async () => {
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: Date.now() });

    const outcome = await runJourney(windowed.toIR(), ctx);

    expect(outcome).toEqual({ status: 'goal' });
    expect(sent).toHaveLength(0);
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

describe('performed anchoring', () => {
  test('goal ignores events from before workflow entry', async () => {
    const wf = workflow('anchor_goal', {
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
    const wf = workflow('anchor_goal', {
      trigger: trigger.event(e.begin_checkout),
      goal: performed(e.purchase),
    }).email(firstTimeRecovery);
    const { ctx, facts, sent } = makeContext();
    facts.events.push({ name: 'purchase', ts: ctx.enteredAtMs + 1 });

    const outcome = await runJourney(wf.toIR(), ctx);

    expect(outcome).toEqual({ status: 'goal' });
    expect(sent).toHaveLength(0);
  });

  test('waitUntil ignores events from before the wait began', async () => {
    const wf = workflow('anchor_wait', { trigger: trigger.event(e.sign_up) }).waitUntil(
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
    const wf = workflow('guarded', {
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
    const atHead = workflow('ab_head', { trigger: trigger.event(e.sign_up) }).cohort(couponArm, {
      key: 'exp1',
    });
    const shifted = workflow('ab_shifted', { trigger: trigger.event(e.sign_up) })
      .email(firstTimeRecovery)
      .cohort(couponArm, { key: 'exp1' });

    for (let i = 0; i < 25; i++) {
      expect(await armOf(atHead, `user_${i}`)).toBe(await armOf(shifted, `user_${i}`));
    }
  });

  test('without a key, position shifts reshuffle assignments (the reason key exists)', async () => {
    const atHead = workflow('ab_head', { trigger: trigger.event(e.sign_up) }).cohort(couponArm);
    const shifted = workflow('ab_shifted', { trigger: trigger.event(e.sign_up) })
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

  test('buckets are stable, in range, and use every remainder length', () => {
    // Keys of length % 4 = 0..3 exercise all tail branches
    for (const key of ['u_12:3', 'u_123:3', 'u_1:3', 'u_12345:3.c0.1']) {
      const bucket = hashToBucket(key);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
      expect(hashToBucket(key)).toBe(bucket);
    }
  });

  test('sequential user ids spread across buckets', () => {
    const buckets = new Set(
      Array.from({ length: 200 }, (_, i) => hashToBucket(`user_${i}:node_3`))
    );
    // 200 sequential keys over 100 buckets: a heavily biased hash would collapse this
    expect(buckets.size).toBeGreaterThan(60);
  });
});

describe('fillSubject: subject templates fill from the profile', () => {
  const profile: Record<string, ScalarIR> = { subscription_plan: 'pro', docs_count: 42 };
  const lookup = (path: string) => Promise.resolve(profile[path]);

  test('placeholders resolve to property values, repeated and mixed with text', async () => {
    await expect(
      fillSubject('Finish upgrading to {{ user.subscription_plan }}', lookup)
    ).resolves.toBe('Finish upgrading to pro');
    await expect(
      fillSubject(
        '{{ user.subscription_plan }}: {{ user.docs_count }} docs on {{ user.subscription_plan }}',
        lookup
      )
    ).resolves.toBe('pro: 42 docs on pro');
  });

  test('the filler is lenient about whitespace even though the type layer is not', async () => {
    await expect(fillSubject('Hi {{user.subscription_plan}}!', lookup)).resolves.toBe('Hi pro!');
    await expect(fillSubject('Hi {{  user.subscription_plan  }}!', lookup)).resolves.toBe(
      'Hi pro!'
    );
  });

  test('a template without placeholders passes through untouched', async () => {
    await expect(fillSubject('Welcome aboard', lookup)).resolves.toBe('Welcome aboard');
  });

  test('a missing property softens to an empty string instead of leaking the placeholder', async () => {
    await expect(fillSubject('Hi {{ user.first_name }}, welcome', lookup)).resolves.toBe(
      'Hi , welcome'
    );
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
