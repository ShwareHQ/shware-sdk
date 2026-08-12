import { describe, expect, test } from 'vitest';
import {
  type EngineStep,
  type FactSource,
  type JourneyContext,
  type OutboundMessage,
  evaluateCondition,
  runJourney,
} from '../src/engine/index';
import { compileBundle } from '../src/index';
import type { ConditionIR, ScalarIR } from '../src/ir';
import { allSegments, checkoutRecovery, nudge, reengagement, winback } from './fixtures';

/* ------------------------------ in-memory ports ------------------------------ */

class FakeStep implements EngineStep {
  readonly sleeps: { name: string; ms: number }[] = [];
  readonly stepNames: string[] = [];
  /** Scripted waitForEvent results, consumed in order; defaults to 'timeout'. */
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

/** Segment definitions come from the compiled bundle — one source of truth with the fixtures. */
const SEGMENT_DEFS: Record<string, ConditionIR> = Object.fromEntries(
  compileBundle({ workflows: [], segments: allSegments }).segments.map((s) => [s.name, s.condition])
);

class FakeFacts implements FactSource {
  events: { name: string; ts: number }[] = [];
  props: Record<string, ScalarIR> = {};

  async countEvents(event: string, sinceMs?: number): Promise<number> {
    return this.events.filter((e) => e.name === event && (sinceMs === undefined || e.ts >= sinceMs))
      .length;
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
