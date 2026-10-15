import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { wakeExpired } from '../src/cloudflare/bindings';
import { JourneyRunner } from '../src/cloudflare/runner';
import type { JourneyObserver, MessageSender, MessageValidator } from '../src/engine/ports';
import { compileBundle, defineContract, trigger, workflow } from '../src/index';
import { TemplateValidationError } from '../src/templates';
import { makeEnv } from './fake-cloudflare';
import { nudge } from './fixtures';
import { NonRetryableError } from './stubs/cloudflare-workflows';

/**
 * The CF adapter's two failure paths.
 *
 * Both used to be invisible: a wait that broke reported a timeout, and an
 * instance that died stayed 'running' in the ledger forever. Neither was
 * reachable from a test either, because `cloudflare:workers` only resolves
 * inside workerd — see the stub wired up in vitest.config.ts.
 */

describe('wakeExpired: a thrown wait is a timeout only if the deadline passed', () => {
  const minute = 60_000;

  test('a failure well inside the window is not a timeout', () => {
    expect(wakeExpired(0, 7 * 24 * 60 * minute, 1_500)).toBe(false);
  });

  test('reaching the deadline is', () => {
    expect(wakeExpired(0, 10 * minute, 10 * minute)).toBe(true);
    expect(wakeExpired(0, 10 * minute, 11 * minute)).toBe(true);
  });

  test('so is arriving a little early, which the platform is allowed to do', () => {
    expect(wakeExpired(0, 10 * minute, 10 * minute - 1_000)).toBe(true);
  });

  test('but not arriving much too early', () => {
    expect(wakeExpired(0, 10 * minute, 9 * minute)).toBe(false);
  });

  test('a wait shorter than the tolerance cannot tell them apart, and says timeout', () => {
    // Degrades to the old behaviour rather than turning every short wait into an error
    expect(wakeExpired(0, 100, 0)).toBe(true);
  });
});

/** CF's WorkflowStep, enough of it to run a journey straight through. */
class FakeCfStep {
  readonly names: string[] = [];
  async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.names.push(name);
    return callback();
  }
  async sleep(): Promise<void> {}
  async sleepUntil(): Promise<void> {}
  async waitForEvent(): Promise<{ payload: unknown; timestamp: Date; type: string }> {
    return { payload: {}, timestamp: new Date(), type: 'wake' };
  }
}

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
    const { env, db, kv } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await kv.put(`wf:${ir.contentHash}`, JSON.stringify(ir));
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
    const { env, db, kv } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await kv.put(`wf:${ir.contentHash}`, JSON.stringify(ir));
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
    const { env, db, kv } = makeEnv();
    const ir = compileBundle({ workflows: [nudge] }).workflows[0];
    await kv.put(`wf:${ir.contentHash}`, JSON.stringify(ir));
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
    const { env, db, kv } = makeEnv();
    const ir = compileBundle({ workflows: [emitter] }).workflows[0];
    await kv.put(`wf:${ir.contentHash}`, JSON.stringify(ir));
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
