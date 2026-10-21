import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { compileConfig } from '../src/config';
import { RegistryActionInvoker } from '../src/engine/actions';
import type { EngineStep } from '../src/engine/ports';
import { executeJourney } from '../src/host/execute';
import { LogMessageSender } from '../src/host/senders';
import { defineConfig, emailTemplate, event, trigger, workflow } from '../src/index';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { renderPostgresDdl } from '../src/store/tables';

/**
 * executeJourney's start: the IR is read in a durable step, so a read that fails is retried by
 * the runtime, and one that keeps failing ends the instance through the failure path.
 */

let pg: PGlite;
const client = (db: { query: PGlite['query'] }): SqlClientLike => ({
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    (await db.query<T>(text, [...params])).rows,
  transaction: (fn) => fn(client(db)),
});

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(renderPostgresDdl());
}, 30_000);
afterAll(async () => {
  await pg.close();
});

const e = event<{ login: Record<string, never> }>();
const hi = emailTemplate({
  id: 'hi',
  from: 'hi@acme.test',
  title: 'Hi',
  props: z.strictObject({}),
  subject: 'Hi',
  preview: {},
  component: () => createElement('p', null, 'hi'),
});
const config = defineConfig({
  workflows: [workflow({ id: 'w', trigger: trigger.event(e.login) }).delay('1 minute')],
  templates: { email: { hi } },
});

/** A step that retries a failing body `retries` times, as the runtimes do, then gives up. */
function retryingStep(retries: number): EngineStep & { names: string[] } {
  const names: string[] = [];
  return {
    names,
    async do(name, fn) {
      names.push(name);
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (attempt >= retries) throw error;
        }
      }
    },
    async sleep() {},
    async subscribe() {},
    async unsubscribe() {},
    async waitForWake() {
      return 'timeout' as const;
    },
  };
}

async function setup(failures: number) {
  await pg.exec('TRUNCATE workflow.entry, workflow.ir, workflow.subscription');
  const store = new PostgresJourneyStore(client(pg));
  const [ir] = compileConfig(config).workflows;
  await store.putWorkflowIR(ir);
  await store.enterJourney({
    workflow: 'w',
    userId: 'u1',
    instanceId: 'i1',
    hash: ir.contentHash,
    ts: Date.now(),
  });
  let left = failures;
  const flaky = new Proxy(store, {
    get(target, property) {
      if (property !== 'getWorkflowIR') return Reflect.get(target, property, target);
      return async (hash: string) => {
        if (left-- > 0) throw new Error('connection terminated unexpectedly');
        return target.getWorkflowIR(hash);
      };
    },
  });
  const parts = {
    store: flaky,
    plain: store,
    env: { JOURNEY: {} as never },
    runtime: {},
    messages: new LogMessageSender(),
    actions: new RegistryActionInvoker([]),
  };
  const params = {
    workflowId: 'w',
    contentHash: ir.contentHash,
    userId: 'u1',
    trigger: { event: 'login', payload: {} },
  };
  return { parts, params };
}

const status = async () =>
  (await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`)).rows[0].status;

describe('executeJourney', () => {
  test('a transient failure reading the IR is retried, and the run goes on', async () => {
    const { parts, params } = await setup(1);
    const step = retryingStep(3);
    const outcome = await executeJourney(
      { instanceId: 'i1', params, enteredAtMs: Date.now(), step },
      parts
    );
    expect(outcome.status).toBe('completed');
    expect(step.names[0]).toBe('$workflow:ir');
    expect(await status()).toBe('completed');
  });

  test('an IR read that keeps failing fails the entry instead of leaving it running', async () => {
    const { parts, params } = await setup(10);
    await expect(
      executeJourney(
        { instanceId: 'i1', params, enteredAtMs: Date.now(), step: retryingStep(2) },
        parts
      )
    ).rejects.toThrow(/connection terminated/);
    expect(await status()).toBe('failed');
  });

  test('the failure path drops the subscriptions: nothing left to poke a dead instance', async () => {
    const { parts, params } = await setup(10);
    // What a wait would have left behind had the instance died parked on it
    await parts.plain.subscribe('i1', 'u1', ['login'], Date.now());
    expect(await parts.plain.findWakeHandles('u1', 'login')).toEqual(['i1']);
    await expect(
      executeJourney(
        { instanceId: 'i1', params, enteredAtMs: Date.now(), step: retryingStep(2) },
        parts
      )
    ).rejects.toThrow(/connection terminated/);
    expect(await status()).toBe('failed');
    expect(await parts.plain.findWakeHandles('u1', 'login')).toEqual([]);
  });
});
