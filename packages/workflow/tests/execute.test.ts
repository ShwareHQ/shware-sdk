import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { compileConfig } from '../src/config';
import { RegistryActionInvoker } from '../src/engine/actions';
import type { EngineStep, JourneyObserver, MessageSender } from '../src/engine/ports';
import { executeJourney } from '../src/host/execute';
import { LogMessageSender } from '../src/host/senders';
import { action, defineConfig, emailTemplate, event, trigger, workflow } from '../src/index';
import { type PgliteDatabase, pgliteDatabase } from './pglite';

/**
 * executeJourney's start: the runner's admission against the user's erasure tombstone, read
 * fresh outside any step; then the IR, read in a durable step, so a read that fails is retried
 * by the runtime, and one that keeps failing ends the instance through the failure path.
 */

let database: PgliteDatabase;
let pg: PgliteDatabase['pg'];

beforeAll(async () => {
  database = await pgliteDatabase();
  pg = database.pg;
}, 30_000);
afterAll(async () => {
  await database.close();
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
/** Who the `record` action ran for: a business step whose repeat a replay must not make. */
const acted: string[] = [];
const record = action('record', async (_args, { userId }) => {
  acted.push(userId);
});
const config = defineConfig({
  workflows: [
    workflow({ id: 'w', trigger: trigger.event(e.login) }).delay('1 minute'),
    workflow({ id: 'mail', trigger: trigger.event(e.login) }).email(hi),
    workflow({ id: 'acted', trigger: trigger.event(e.login) })
      .run(record)
      .email(hi),
  ],
  actions: [record],
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
  const store = database.store;
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
  const plain = database.store;
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

/* ----------------------------- finalize replay ----------------------------- */

/**
 * A step with checkpoints, as the runtimes keep them: a `do` result is recorded by name and a
 * recorded name is answered without running the body. `loseCheckpoint` names a step whose body
 * runs to the end but whose checkpoint is never committed — the instance dies in between.
 */
function checkpointedStep(
  results = new Map<string, unknown>(),
  loseCheckpoint?: string
): EngineStep & { names: string[]; results: Map<string, unknown> } {
  const names: string[] = [];
  return {
    names,
    results,
    async do(name, fn) {
      names.push(name);
      if (results.has(name)) return results.get(name) as never;
      const result = await fn();
      if (name === loseCheckpoint) throw new Error(`evicted after '${name}'`);
      results.set(name, result);
      return result;
    },
    async sleep() {},
    async subscribe() {},
    async unsubscribe() {},
    async waitForWake() {
      return 'timeout' as const;
    },
  };
}

/**
 * One workflow entered for u1 with a subscription left behind (what a wait leaves), the outlets
 * counted, and two faults to arm: `unsubscribe` and the observer's `finished` each fail the
 * next time they are called — the finalize interrupted after its status write, or after its
 * unsubscribe. A failing sender fails the journey itself, for the failed finalize.
 */
async function finalizeSetup(workflowId: 'mail' | 'acted', options: { sendFails?: boolean } = {}) {
  await pg.exec('TRUNCATE workflow.entry, workflow.ir, workflow.subscription, workflow.erasure');
  acted.length = 0;
  const plain = database.store;
  const ir = irOf(workflowId);
  await plain.putWorkflowIR(ir);
  await plain.enterJourney({
    workflow: workflowId,
    userId: 'u1',
    instanceId: 'i1',
    hash: ir.contentHash,
    ts: Date.now(),
  });
  await plain.subscribe('i1', 'u1', ['login'], Date.now());
  const faults = { unsubscribe: 0, finished: 0 };
  const admissions: boolean[] = [];
  const store = new Proxy(plain, {
    get(target, property) {
      if (property === 'admitInstance') {
        return async (instanceId: string, userId: string) => {
          const verdict = await target.admitInstance(instanceId, userId);
          admissions.push(verdict);
          return verdict;
        };
      }
      if (property === 'unsubscribe') {
        return async (instanceId: string) => {
          if (faults.unsubscribe-- > 0) throw new Error('connection terminated unexpectedly');
          return target.unsubscribe(instanceId);
        };
      }
      return Reflect.get(target, property, target);
    },
  });
  const sent: string[] = [];
  const messages: MessageSender = {
    send: async (message) => {
      if (options.sendFails) throw new Error('sender is down');
      sent.push(message.template);
    },
  };
  const finished: string[] = [];
  const observer: JourneyObserver = {
    finished: async ({ status }) => {
      if (faults.finished-- > 0) throw new Error('reporting is down');
      finished.push(status);
    },
  };
  const parts = {
    store,
    env: { JOURNEY: {} as never },
    runtime: {},
    messages,
    actions: new RegistryActionInvoker([record]),
    observer,
  };
  const params = {
    workflowId,
    contentHash: ir.contentHash,
    userId: 'u1',
    trigger: { event: 'login', payload: {} },
  };
  const run = (step: EngineStep) =>
    executeJourney({ instanceId: 'i1', params, enteredAtMs: Date.now(), step }, parts);
  const subscribed = () => plain.findWakeHandles('u1', 'login');
  return { plain, faults, admissions, sent, finished, run, subscribed };
}

describe('a finalize interrupted is replayed by the same admitted instance', () => {
  test('after the status, before the unsubscribe: the outcome stands, the subscriptions go, finished is recorded', async () => {
    const h = await finalizeSetup('mail');
    h.faults.unsubscribe = 1;
    const first = checkpointedStep();
    await expect(h.run(first)).rejects.toThrow(/connection terminated/);
    expect(await status()).toBe('completed');
    expect(await h.subscribed()).toEqual(['i1']);
    expect(h.finished).toEqual([]);
    expect(h.sent).toEqual(['hi']);

    // Rebuilt on its checkpoints: admitted again (the entry is no longer running, but it is
    // this instance's), the email not resent, the finalize run to its end
    await expect(h.run(checkpointedStep(first.results))).resolves.toMatchObject({
      status: 'completed',
    });
    expect(h.admissions).toEqual([true, true]);
    expect(h.sent).toEqual(['hi']);
    expect(await status()).toBe('completed');
    expect(await h.subscribed()).toEqual([]);
    expect(h.finished).toEqual(['completed']);
    expect(await h.plain.erasureState('u1')).toBe('none');
  });

  test('after the unsubscribe, before finished: the replay records finished', async () => {
    const h = await finalizeSetup('mail');
    h.faults.finished = 1;
    const first = checkpointedStep();
    await expect(h.run(first)).rejects.toThrow(/reporting is down/);
    expect(await status()).toBe('completed');
    expect(await h.subscribed()).toEqual([]);
    expect(h.finished).toEqual([]);

    await expect(h.run(checkpointedStep(first.results))).resolves.toMatchObject({
      status: 'completed',
    });
    expect(h.sent).toEqual(['hi']);
    expect(await status()).toBe('completed');
    expect(h.finished).toEqual(['completed']);
  });

  test('every write done, the checkpoint not committed: the replay is idempotent', async () => {
    const h = await finalizeSetup('mail');
    const first = checkpointedStep(new Map(), 'finalize');
    await expect(h.run(first)).rejects.toThrow(/evicted after 'finalize'/);
    expect(await status()).toBe('completed');
    expect(await h.subscribed()).toEqual([]);
    expect(h.finished).toEqual(['completed']);

    await expect(h.run(checkpointedStep(first.results))).resolves.toMatchObject({
      status: 'completed',
    });
    expect(h.sent).toEqual(['hi']);
    expect(await status()).toBe('completed');
    expect(await h.subscribed()).toEqual([]);
    // The hook ran again — it was never checkpointed — with the same result; the persisted
    // state is what the replay must leave idempotent
    expect(h.finished.length).toBeGreaterThanOrEqual(1);
    expect(h.finished.every((s) => s === 'completed')).toBe(true);
  });

  test('a failed finalize keeps its failure: the action is not rerun, and nothing reads as erased', async () => {
    const h = await finalizeSetup('acted', { sendFails: true });
    h.faults.unsubscribe = 1;
    const first = checkpointedStep();
    await expect(h.run(first)).rejects.toThrow(/connection terminated/);
    expect(acted).toEqual(['u1']);
    expect(await status()).toBe('failed');
    expect(await h.subscribed()).toEqual(['i1']);
    expect(h.finished).toEqual([]);

    // The replay reuses the action's checkpoint, fails the send again, and finishes the failure
    await expect(h.run(checkpointedStep(first.results))).rejects.toThrow(/sender is down/);
    expect(h.admissions).toEqual([true, true]);
    expect(acted).toEqual(['u1']);
    expect(await status()).toBe('failed');
    expect(await h.subscribed()).toEqual([]);
    expect(h.finished).toEqual(['failed']);
    expect(await h.plain.erasureState('u1')).toBe('none');
  });

  test('a tombstone before the replay refuses it: no finalize, nothing reported', async () => {
    const warned = quiet();
    try {
      const h = await finalizeSetup('mail');
      h.faults.unsubscribe = 1;
      const first = checkpointedStep();
      await expect(h.run(first)).rejects.toThrow(/connection terminated/);
      await h.plain.requestErasure('u1', Date.now());

      const replay = checkpointedStep(first.results);
      await expect(h.run(replay)).resolves.toEqual({ status: 'exited', reason: 'erased' });
      expect(h.admissions).toEqual([true, false]);
      expect(replay.names).toEqual([]);
      expect(h.finished).toEqual([]);
      expect(h.sent).toEqual(['hi']);
      // Left as the interruption left it: the erasure, not the runner, finishes with the entry
      expect(await status()).toBe('completed');
      expect(await h.subscribed()).toEqual(['i1']);
    } finally {
      warned.mockRestore();
    }
  });
});
