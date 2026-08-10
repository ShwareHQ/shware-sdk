import { describe, expect, test } from 'vitest';
import type { ConditionIR, ScalarIR } from '../ir';
import { checkoutRecovery } from '../workflows/index';
import { reengagement } from '../workflows/reengagement';
import { winback } from '../workflows/winback';
import { runJourney } from './interpreter';
import type { EngineStep, FactSource, JourneyContext, OutboundMessage } from './ports';

/* ------------------------------ in-memory ports ------------------------------ */

class FakeStep implements EngineStep {
  readonly sleeps: { name: string; ms: number }[] = [];
  readonly stepNames: string[] = [];
  /** scripted waitForEvent results, consumed in order; defaults to 'timeout'. */
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
  async waitForEvent(): Promise<'event' | 'timeout'> {
    return this.wakeScript.shift() ?? 'timeout';
  }
}

class FakeFacts implements FactSource {
  events: { name: string; ts: number }[] = [];
  props: Record<string, ScalarIR> = {};
  segments: Record<string, ConditionIR> = {};

  async countEvents(event: string, sinceMs?: number): Promise<number> {
    return this.events.filter((e) => e.name === event && (sinceMs === undefined || e.ts >= sinceMs))
      .length;
  }
  async getProperty(path: string): Promise<ScalarIR | undefined> {
    return this.props[path];
  }
  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    return this.segments[name];
  }
}

function makeContext(overrides?: { facts?: FakeFacts; step?: FakeStep }) {
  const step = overrides?.step ?? new FakeStep();
  const facts = overrides?.facts ?? new FakeFacts();
  const sent: OutboundMessage[] = [];
  const emitted: { event: string; payload: Record<string, ScalarIR | undefined> }[] = [];
  const ctx: JourneyContext = {
    userId: 'u_1',
    instanceId: 'inst_1',
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

/** Seed segment definitions the example workflows reference. */
function seedSegments(facts: FakeFacts): void {
  facts.segments.purchaser = {
    type: 'performed',
    event: 'purchase',
    within: { value: '30 days', ms: 2_592_000_000 },
  };
  facts.segments.active_subscriber = {
    type: 'and',
    conditions: [
      { type: 'property', path: 'subscription_status', op: 'eq', value: 'active' },
      { type: 'property', path: 'auto_renew_enabled', op: 'eq', value: true },
    ],
  };
  facts.segments.inactive_30d = {
    type: 'not',
    condition: {
      type: 'performed',
      event: 'login',
      within: { value: '30 days', ms: 2_592_000_000 },
    },
  };
}

/* ---------------------------------- tests ---------------------------------- */

describe('runJourney: checkoutRecovery', () => {
  const ir = checkoutRecovery.toIR();

  test('non-subscriber takes the otherwise arm: n1 -> 23h -> n2', async () => {
    const { ctx, step, facts, sent } = makeContext();
    seedSegments(facts);

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
    seedSegments(facts);
    facts.props = {
      subscription_status: 'active',
      auto_renew_enabled: true,
      subscription_plan: 'pro',
    };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.template)).toEqual(['u1_upgrade_recovery']);
    // user_property ref resolved from the profile
    expect(sent[0]?.props).toEqual({ plan: 'pro' });
    expect(sent[0]?.idempotencyKey).toBe('inst_1:1.c0.0');
  });

  test('goal (purchase) met at a node boundary exits before sending', async () => {
    const { ctx, facts, sent } = makeContext();
    seedSegments(facts);
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
    seedSegments(facts);
    facts.props = { subscription_plan: 'business' };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'exited', reason: 'handed_to_cs' });
    expect(sent.map((m) => m.channel)).toEqual(['slack']);
  });

  test('pro arm rejoins the shared tail (final offer)', async () => {
    const { ctx, facts, sent } = makeContext();
    seedSegments(facts);
    facts.props = { subscription_plan: 'pro' };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.template)).toEqual(['winback_pro_offer', 'winback_final_offer']);
  });
});

describe('runJourney: reengagement (wait_until)', () => {
  const ir = reengagement.toIR();

  test('wake with condition met exits as reengaged', async () => {
    const { ctx, step, facts, sent } = makeContext();
    seedSegments(facts);
    step.wakeScript = ['event'];
    // first check false, post-wake check true: login arrives between
    let checks = 0;
    facts.countEvents = async (event: string) => {
      if (event !== 'login') return 0;
      checks += 1;
      return checks >= 2 ? 1 : 0;
    };

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'exited', reason: 'reengaged' });
    expect(sent.map((m) => m.template)).toEqual(['reengage_miss_you']);
  });

  test('timeout continues the main line into the highlights email', async () => {
    const { ctx, sent } = makeContext();
    seedSegments(ctx.facts as FakeFacts);

    const outcome = await runJourney(ir, ctx);

    expect(outcome).toEqual({ status: 'completed' });
    // still-inactive users then hit the trailing A/B: the coupon arm may add one send
    expect(sent.slice(0, 2).map((m) => m.template)).toEqual([
      'reengage_miss_you',
      'reengage_product_highlights',
    ]);
    expect(sent.slice(2).every((m) => m.template === 'reengage_incentive')).toBe(true);
  });

  test('cohort bucketing is deterministic per user', async () => {
    const run = async (userId: string) => {
      const { ctx, facts, sent } = makeContext();
      seedSegments(facts);
      ctx.userId = userId;
      // still inactive at the trailing branch so the cohort runs
      await runJourney(ir, ctx);
      return sent.some((m) => m.template === 'reengage_incentive');
    };

    const first = await run('user_a');
    const second = await run('user_a');
    expect(first).toBe(second);

    // across many users both arms are used
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(`user_${i}`)));
    expect(new Set(results).size).toBe(2);
  });
});

describe('step naming', () => {
  test('step names derive from structural node ids', async () => {
    const { ctx, step, facts } = makeContext();
    seedSegments(facts);

    await runJourney(checkoutRecovery.toIR(), ctx);

    expect(step.stepNames).toContain('0:guard');
    expect(step.stepNames).toContain('1:eval');
    expect(step.stepNames).toContain('1.o.0:send');
  });
});
