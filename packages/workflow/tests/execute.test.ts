import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { compileConfig } from '../src/config';
import { RegistryActionInvoker } from '../src/engine/actions';
import type { EngineStep, JourneyObserver, MessageSender } from '../src/engine/ports';
import { executeJourney } from '../src/host/execute';
import { LogMessageSender } from '../src/host/senders';
import { defineConfig, emailTemplate, event, trigger, workflow } from '../src/index';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { renderPostgresDdl } from '../src/store/tables';

/**
 * executeJourney's start: the runner's admission against the user's erasure tombstone, read
 * fresh outside any step; then the IR, read in a durable step, so a read that fails is retried
 * by the runtime, and one that keeps failing ends the instance through the failure path.
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
  workflows: [
    workflow({ id: 'w', trigger: trigger.event(e.login) }).delay('1 minute'),
    workflow({ id: 'mail', trigger: trigger.event(e.login) }).email(hi),
  ],
  templates: { email: { hi } },
});
/** The compiled IR of one of the config's workflows, by id. */
const irOf = (id: string) => {
  const found = compileConfig(config).workflows.find((w) => w.id === id);
  if (found === undefined) throw new Error(`no workflow '${id}'`);
  return found;
};

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
  const ir = irOf('w');
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

/* --------------------------------- admission -------------------------------- */

/** An erasure state read by the store, reported through console.warn; quiet it. */
const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

/**
 * The `mail` workflow entered for u1, with the outlets counted: a sender, an observer hearing
 * `started`, and the IR read showing in the step names.
 */
async function admissionSetup(admitFailures: { count: number; error?: Error } = { count: 0 }) {
  await pg.exec('TRUNCATE workflow.entry, workflow.ir, workflow.subscription, workflow.erasure');
  const plain = new PostgresJourneyStore(client(pg));
  const ir = irOf('mail');
  await plain.putWorkflowIR(ir);
  await plain.enterJourney({
    workflow: 'mail',
    userId: 'u1',
    instanceId: 'i1',
    hash: ir.contentHash,
    ts: Date.now(),
  });
  let left = admitFailures.count;
  const admissions: boolean[] = [];
  const store = new Proxy(plain, {
    get(target, property) {
      if (property !== 'admitInstance') return Reflect.get(target, property, target);
      return async (instanceId: string, userId: string) => {
        if (left-- > 0)
          throw admitFailures.error ?? new Error('connection terminated unexpectedly');
        const verdict = await target.admitInstance(instanceId, userId);
        admissions.push(verdict);
        return verdict;
      };
    },
  });
  const sent: string[] = [];
  const messages: MessageSender = {
    send: async (message) => {
      sent.push(message.template);
    },
  };
  const started: string[] = [];
  const observer: JourneyObserver = {
    started: async ({ instanceId }) => {
      started.push(instanceId);
    },
  };
  const parts = {
    store,
    plain,
    env: { JOURNEY: {} as never },
    runtime: {},
    messages,
    actions: new RegistryActionInvoker([]),
    observer,
  };
  const params = {
    workflowId: 'mail',
    contentHash: ir.contentHash,
    userId: 'u1',
    trigger: { event: 'login', payload: {} },
  };
  const run = (step: EngineStep = retryingStep(0)) =>
    executeJourney({ instanceId: 'i1', params, enteredAtMs: Date.now(), step }, parts);
  return { parts, params, run, sent, started, admissions };
}

describe('executeJourney admits the runner before anything observable', () => {
  test('a user with a tombstone is refused: no started, no IR read, no send, no finalize', async () => {
    const warned = quiet();
    try {
      const { parts, run, sent, started } = await admissionSetup();
      await parts.plain.requestErasure('u1', Date.now());
      const step = retryingStep(0);
      await expect(run(step)).resolves.toEqual({ status: 'exited', reason: 'erased' });
      expect(started).toEqual([]);
      expect(step.names).toEqual([]);
      expect(sent).toEqual([]);
      // The entry is the erasure's to finish with: it is neither completed nor failed by us
      expect(await status()).toBe('running');
      expect(warned).toHaveBeenCalledWith(expect.stringMatching(/i1 of u1 refused admission/));
    } finally {
      warned.mockRestore();
    }
  });

  test('an entry no longer in the ledger is refused the same way', async () => {
    const warned = quiet();
    try {
      const { parts, run, sent, started } = await admissionSetup();
      await parts.plain.removeEntry('i1');
      await expect(run()).resolves.toEqual({ status: 'exited', reason: 'erased' });
      expect(started).toEqual([]);
      expect(sent).toEqual([]);
    } finally {
      warned.mockRestore();
    }
  });

  test('an admitted runner runs as before, and the admission is recorded', async () => {
    const { parts, run, sent, started, admissions } = await admissionSetup();
    const step = retryingStep(0);
    await expect(run(step)).resolves.toMatchObject({ status: 'completed' });
    expect(admissions).toEqual([true]);
    expect(started).toEqual(['i1']);
    expect(step.names[0]).toBe('$workflow:ir');
    expect(sent).toEqual(['hi']);
    expect(await status()).toBe('completed');
    expect((await parts.plain.runningInstances('u1')).map((i) => i.admitted)).toEqual([]);
  });

  test('a read that stumbles once is tried again: the run goes on, once', async () => {
    const warned = quiet();
    try {
      const { run, sent, started, admissions } = await admissionSetup({ count: 1 });
      await expect(run()).resolves.toMatchObject({ status: 'completed' });
      expect(admissions).toEqual([true]);
      expect(started).toEqual(['i1']);
      expect(sent).toEqual(['hi']);
      expect(warned).toHaveBeenCalledWith(
        expect.stringMatching(/admission: read failed for instance i1 \(attempt 1 of 3\)/),
        expect.any(Error)
      );
    } finally {
      warned.mockRestore();
    }
  });

  test('a read that keeps failing throws without running anything, and the entry stays', async () => {
    const warned = quiet();
    try {
      const { run, sent, started } = await admissionSetup({ count: 10 });
      await expect(run()).rejects.toThrow(/connection terminated/);
      expect(started).toEqual([]);
      expect(sent).toEqual([]);
      // Not a failure of the journey: nothing ran, and the ledger is left to the next attempt
      expect(await status()).toBe('running');
    } finally {
      warned.mockRestore();
    }
  });
});
