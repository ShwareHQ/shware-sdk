import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { wakeExpired } from '../src/cloudflare/bindings';
import { d1Store } from '../src/cloudflare/d1-env';
import { JourneyRunner } from '../src/cloudflare/runner';
import type {
  JourneyObserver,
  MessageSender,
  MessageValidator,
  OutboundMessage,
} from '../src/engine/ports';
import { compileBundle, defineContract, performed, trigger, workflow } from '../src/index';
import { TemplateValidationError } from '../src/templates';
import { makeEnv } from './fake-cloudflare';
import { e, gettingStarted, nudge } from './fixtures';
import { EvictionError, FakeCfStep } from './stubs/cf-step';
import { NonRetryableError } from './stubs/cloudflare-workflows';

/**
 * The CF adapter's failure paths and its wait semantics.
 *
 * They used to be invisible: a wait that broke reported a timeout, a wait that genuinely timed
 * out after an eviction reported a failure, and an instance that died stayed 'running' in the
 * ledger forever. None was reachable from a test either, because `cloudflare:workers` only
 * resolves inside workerd — see the stubs wired up in vitest.config.ts.
 */

describe('wakeExpired: a thrown wait is a timeout only if the deadline passed', () => {
  const minute = 60_000;
  const deadline = 10 * minute;

  test('a failure well inside the window is not a timeout', () => {
    expect(wakeExpired(deadline, 1_500)).toBe(false);
  });

  test('reaching the deadline is', () => {
    expect(wakeExpired(deadline, deadline)).toBe(true);
    expect(wakeExpired(deadline, deadline + minute)).toBe(true);
  });

  test('so is arriving a little early, which the platform is allowed to do', () => {
    expect(wakeExpired(deadline, deadline - 1_000)).toBe(true);
  });

  test('but not arriving much too early', () => {
    expect(wakeExpired(deadline, 9 * minute)).toBe(false);
  });

  test('a wait shorter than the tolerance cannot tell them apart, and says timeout', () => {
    // Degrades to the old behaviour rather than turning every short wait into an error
    expect(wakeExpired(100, 0)).toBe(true);
  });
});

class ExplodingRunner extends JourneyRunner {
  protected override createMessageSender(): MessageSender {
    return {
      send: async () => {
        throw new Error('sender is down');
      },
    };
  }
}

describe('an instance that dies stops reading as running', () => {
  const setup = async () => {
    const { env, db } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await d1Store(env).putWorkflowIR(ir);
    db.entries.push({
      workflow: ir.id,
      user_id: 'u1',
      instance_id: 'inst-1',
      hash: ir.contentHash,
      status: 'running',
      ts: Date.now(),
    });
    const event = {
      payload: {
        workflowId: ir.id,
        contentHash: ir.contentHash,
        userId: 'u1',
        trigger: { event: 'sign_up', payload: {} },
      },
      timestamp: new Date(),
      instanceId: 'inst-1',
    };
    return { env, db, event };
  };

  test('the ledger records the failure instead of leaving it mid-flight', async () => {
    const { env, db, event } = await setup();
    const runner = new ExplodingRunner({}, env);

    await expect(runner.run(event as never, new FakeCfStep() as never)).rejects.toThrow(
      'sender is down'
    );

    expect(db.entries[0].status).toBe('failed');
  });

  test('a journey that ends normally still records its outcome', async () => {
    const { env, db, event } = await setup();
    const runner = new JourneyRunner({}, env);

    await expect(runner.run(event as never, new FakeCfStep() as never)).resolves.toMatchObject({
      status: 'completed',
    });

    expect(db.entries[0].status).toBe('completed');
  });
});

describe('the observer hears how each instance ended', () => {
  const finishedOf = (Base: typeof JourneyRunner) => {
    const finished: string[] = [];
    class Observed extends Base {
      protected override createObserver(): JourneyObserver {
        return {
          finished: async ({ workflow: name, instanceId, status }) => {
            finished.push(`${name}/${instanceId}:${status}`);
          },
        };
      }
    }
    return { Observed, finished };
  };

  const event = async () => {
    const { env, db } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await d1Store(env).putWorkflowIR(ir);
    db.entries.push({
      workflow: ir.id,
      user_id: 'u1',
      instance_id: 'inst-1',
      hash: ir.contentHash,
      status: 'running',
      ts: Date.now(),
    });
    return {
      env,
      ir,
      event: {
        payload: {
          workflowId: ir.id,
          contentHash: ir.contentHash,
          userId: 'u1',
          trigger: { event: 'sign_up', payload: {} },
        },
        timestamp: new Date(),
        instanceId: 'inst-1',
      },
    };
  };

  test('a normal ending reports its outcome', async () => {
    const { env, ir, event: e1 } = await event();
    const { Observed, finished } = finishedOf(JourneyRunner);
    await new Observed({}, env).run(e1, new FakeCfStep() as never);
    expect(finished).toEqual([`${ir.id}/inst-1:completed`]);
  });

  test('an error ending reports failed', async () => {
    const { env, ir, event: e1 } = await event();
    const { Observed, finished } = finishedOf(ExplodingRunner);
    await expect(new Observed({}, env).run(e1, new FakeCfStep() as never)).rejects.toThrow(
      'sender is down'
    );
    expect(finished).toEqual([`${ir.id}/inst-1:failed`]);
  });
});

class RefusingRunner extends JourneyRunner {
  sent = 0;
  protected override createMessageValidator(): MessageValidator {
    return {
      validate: ({ template }) => {
        throw new TemplateValidationError('email', template, 'props', [
          { path: 'name', message: 'required' },
        ]);
      },
    };
  }
  protected override createMessageSender(): MessageSender {
    return { send: async () => void this.sent++ };
  }
}

describe('a template refusing its props', () => {
  test('ends the step as non-retryable, sends nothing, and records the failure', async () => {
    const { env, db } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await d1Store(env).putWorkflowIR(ir);
    db.entries.push({
      workflow: ir.id,
      user_id: 'u1',
      instance_id: 'inst-2',
      hash: ir.contentHash,
      status: 'running',
      ts: Date.now(),
    });
    const event = {
      payload: {
        workflowId: ir.id,
        contentHash: ir.contentHash,
        userId: 'u1',
        trigger: { event: 'sign_up', payload: {} },
      },
      timestamp: new Date(),
      instanceId: 'inst-2',
    };
    const runner = new RefusingRunner({}, env);
    const error = await runner
      .run(event as never, new FakeCfStep() as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NonRetryableError);
    // The engine tells a NonRetryableError by its name: the original's must not write over it
    expect((error as Error).name).toBe('NonRetryableError');
    expect((error as Error).cause).toBeInstanceOf(TemplateValidationError);
    expect((error as Error).message).toMatch(
      /\[inst-2 0\] email template .* rejected its props: name required/
    );
    expect(runner.sent).toBe(0);
    expect(db.entries[0].status).toBe('failed');
  });
});

describe('an emitted event the contract refuses', () => {
  test('ends the step as non-retryable and stores nothing', async () => {
    const shop = defineContract({
      events: {
        sign_up: z.looseObject({}),
        purchase: z.looseObject({ transaction_id: z.string(), value: z.number().positive() }),
      },
      profile: z.strictObject({ name: z.string() }),
    });
    const emitter = workflow({
      id: 'emitter',
      trigger: trigger.event(shop.events.sign_up),
    }).sendEvent(shop.events.purchase, { transaction_id: 't', value: -1 });
    const { env, db } = makeEnv();
    const ir = compileBundle({ workflows: [emitter] }).workflows[0];
    await d1Store(env).putWorkflowIR(ir);
    db.entries.push({
      workflow: ir.id,
      user_id: 'u1',
      instance_id: 'inst-3',
      hash: ir.contentHash,
      status: 'running',
      ts: Date.now(),
    });
    class ContractRunner extends JourneyRunner {
      protected override contract() {
        return shop;
      }
    }
    const event = {
      payload: {
        workflowId: ir.id,
        contentHash: ir.contentHash,
        userId: 'u1',
        trigger: { event: 'sign_up', payload: {} },
      },
      timestamp: new Date(),
      instanceId: 'inst-3',
    };
    const error = await new ContractRunner({}, env)
      .run(event as never, new FakeCfStep() as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NonRetryableError);
    expect((error as Error).message).toMatch(
      /\[inst-3 0\] event 'purchase' refused by the contract: value/
    );
    expect(db.events.filter((e) => e.name === 'purchase')).toEqual([]);
  });
});

/* ------------------------------ wait semantics ------------------------------ */

/** A runner that collects what it sends, so the test sees the journey go on after a wait. */
class CollectingRunner extends JourneyRunner {
  readonly sent: OutboundMessage[] = [];
  protected override createMessageSender(): MessageSender {
    return {
      send: async (message) => {
        this.sent.push(message);
      },
    };
  }
}

const waiter = workflow({ id: 'waiter', trigger: trigger.event(e.sign_up) })
  .waitUntil(performed(e.login), { timeout: '1 hour', onTimeout: 'continue' })
  .email(gettingStarted);

/** Fridays 09:00–17:00 UTC: on the clock the tests set, the next window is days away. */
const windowed = workflow({ id: 'windowed', trigger: trigger.event(e.sign_up) })
  .timeWindow({ days: ['fri'], between: ['09:00', '17:00'], tz: 'UTC' })
  .email(gettingStarted);

async function seeded(flow: typeof waiter, instanceId: string) {
  const { env, db } = makeEnv();
  const ir = compileBundle({ workflows: [flow] }).workflows[0];
  await d1Store(env).putWorkflowIR(ir);
  db.entries.push({
    workflow: ir.id,
    user_id: 'u1',
    instance_id: instanceId,
    hash: ir.contentHash,
    status: 'running',
    ts: Date.now(),
  });
  const event = {
    payload: {
      workflowId: ir.id,
      contentHash: ir.contentHash,
      userId: 'u1',
      trigger: { event: 'sign_up', payload: {} },
    },
    timestamp: new Date(),
    instanceId,
  };
  return { env, db, event };
}

describe('a wait that throws', () => {
  const T0 = new Date('2026-10-19T12:00:00Z'); // a Monday

  afterEach(() => {
    vi.useRealTimers();
  });

  test('is a timeout when the deadline passed — also on the replay after an eviction', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const { env, db, event } = await seeded(waiter, 'inst-w1');
    const runner = new CollectingRunner({}, env);

    // The live attempt parks on the wait and the isolate is evicted there: every checkpoint up
    // to the wait is kept, nothing after it exists
    const first = new FakeCfStep();
    first.evictAt = '0:wait:0';
    await expect(runner.run(event as never, first as never)).rejects.toBeInstanceOf(EvictionError);
    expect(first.results.has('0:deadline')).toBe(true);
    expect(first.results.has('0:wait:0:timed-out')).toBe(false);

    // The runtime rebuilds the instance once the hour is over: the wait resurfaces as a throw,
    // and the first thing to run is the verdict. Measured from this clock the park would look
    // brand new; measured against the checkpointed deadline it is the timeout it is.
    vi.setSystemTime(new Date(T0.getTime() + 61 * 60_000));
    const replay = first.replay();
    replay.wakes = ['timeout'];
    const again = new CollectingRunner({}, env);

    await expect(again.run(event as never, replay as never)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(replay.results.get('0:wait:0:timed-out')).toBe(true);
    expect(again.sent.map((m) => m.template)).toEqual(['getting_started']);
    expect(db.entries[0].status).toBe('completed');
  });

  test('is a failure when the deadline has not passed: the error comes back out', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const { env, db, event } = await seeded(waiter, 'inst-w2');
    const runner = new CollectingRunner({}, env);
    const step = new FakeCfStep();
    step.wakes = [new Error('binding exploded')];

    await expect(runner.run(event as never, step as never)).rejects.toThrow('binding exploded');
    expect(step.results.get('0:wait:0:timed-out')).toBe(false);
    expect(runner.sent).toEqual([]);
    expect(db.entries[0].status).toBe('failed');
  });

  test('a wake lets the journey check and go on', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const { env, db, event } = await seeded(waiter, 'inst-w3');
    const runner = new CollectingRunner({}, env);
    const step = new FakeCfStep();
    // The login lands while the instance is parked, and the wake follows it
    step.wakes = [
      () => {
        db.events.push({ id: 'ev1', user_id: 'u1', name: 'login', ts: Date.now(), payload: '{}' });
        return 'event';
      },
    ];

    await expect(runner.run(event as never, step as never)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(step.results.get('0:check:0')).toBeNull();
    expect(step.results.get('0:check:1')).toBe(true);
    expect(runner.sent.map((m) => m.template)).toEqual(['getting_started']);
    expect(db.entries[0].status).toBe('completed');
  });
});

describe('a time window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('replayed after its target passed sleeps the recorded time and does not throw', async () => {
    const T0 = new Date('2026-10-19T12:00:00Z'); // Monday noon: the next window is Friday 09:00
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const { env, db, event } = await seeded(windowed, 'inst-tw');

    const first = new FakeCfStep();
    first.evictAt = '0:sleep';
    await expect(
      new CollectingRunner({}, env).run(event as never, first as never)
    ).rejects.toBeInstanceOf(EvictionError);
    const remaining = first.results.get('0:remaining');
    expect(remaining).toBe(new Date('2026-10-23T09:00:00Z').getTime() - T0.getTime());

    // Rebuilt a week later: the target is long gone, and a sleep recomputed from this clock
    // would be negative. The checkpointed remaining time is what the instance sleeps.
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    const replay = first.replay();
    const runner = new CollectingRunner({}, env);
    await expect(runner.run(event as never, replay as never)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(replay.sleeps).toEqual([{ name: '0:sleep', ms: remaining }]);
    expect(runner.sent.map((m) => m.template)).toEqual(['getting_started']);
    expect(db.entries[0].status).toBe('completed');
  });
});

/* ------------------------------- admission ------------------------------- */

/** A collecting runner that also hears `started`: the first observable effect of a run. */
class HearingRunner extends CollectingRunner {
  readonly started: string[] = [];
  protected override createObserver(): JourneyObserver {
    return {
      started: async ({ instanceId }) => {
        this.started.push(instanceId);
      },
    };
  }
}

describe('a runner refuses an erased user before its first effect', () => {
  const T0 = new Date('2026-10-19T12:00:00Z');

  afterEach(() => {
    vi.useRealTimers();
  });

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  test('on a fresh invocation: no started, no step, no send, and the entry is left alone', async () => {
    const warned = quiet();
    try {
      const { env, db, event } = await seeded(waiter, 'inst-e1');
      db.erasures.set('u1', { ts: 1, erased_at: null });
      const runner = new HearingRunner({}, env);
      const step = new FakeCfStep();

      await expect(runner.run(event as never, step as never)).resolves.toEqual({
        status: 'exited',
        reason: 'erased',
      });
      expect(runner.started).toEqual([]);
      expect(step.names).toEqual([]);
      expect(runner.sent).toEqual([]);
      expect(db.entries[0].status).toBe('running');
    } finally {
      warned.mockRestore();
    }
  });

  test('on a replay after an eviction: the admission is read fresh, not from a checkpoint', async () => {
    const warned = quiet();
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    try {
      const { env, db, event } = await seeded(waiter, 'inst-e2');
      const runner = new HearingRunner({}, env);
      const first = new FakeCfStep();
      first.evictAt = '0:wait:0';
      await expect(runner.run(event as never, first as never)).rejects.toBeInstanceOf(
        EvictionError
      );
      expect(runner.started).toEqual(['inst-e2']);
      expect(await d1Store(env).runningInstances('u1')).toEqual([
        { instanceId: 'inst-e2', admitted: true },
      ]);

      // The user is erased while the instance is parked; the hour passes and it is rebuilt
      db.erasures.set('u1', { ts: Date.now(), erased_at: null });
      vi.setSystemTime(new Date(T0.getTime() + 61 * 60_000));
      const replay = first.replay();
      replay.wakes = ['timeout'];
      const again = new HearingRunner({}, env);

      await expect(again.run(event as never, replay as never)).resolves.toEqual({
        status: 'exited',
        reason: 'erased',
      });
      expect(again.started).toEqual([]);
      expect(replay.names).toEqual([]);
      expect(again.sent).toEqual([]);
      expect(db.entries[0].status).toBe('running');
    } finally {
      warned.mockRestore();
    }
  });
});
