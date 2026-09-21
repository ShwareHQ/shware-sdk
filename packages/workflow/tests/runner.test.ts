import { describe, expect, test } from 'vitest';
import { wakeExpired } from '../src/cloudflare/bindings';
import { JourneyRunner } from '../src/cloudflare/runner';
import type { MessageSender } from '../src/engine/ports';
import { compileBundle } from '../src/index';
import { makeEnv } from './fake-cloudflare';
import { nudge } from './fixtures';

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
      workflow: ir.name,
      user_id: 'u1',
      instance_id: 'inst-1',
      hash: ir.contentHash,
      status: 'running',
      ts: Date.now(),
    });
    const event = {
      payload: {
        workflowName: ir.name,
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
