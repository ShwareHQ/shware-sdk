import { webcrypto } from 'node:crypto';
import { type Http2Server, createServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from '@aws/durable-execution-sdk-js-testing';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  AwsInstances,
  type FunctionUrlEvent,
  type LambdaApi,
  RUN_EVENT_TYPE,
  type RunInput,
  SWEEP_EVENT_TYPE,
  executionName,
  journeyLambda,
} from '../src/aws';
import { compileConfig } from '../src/config';
import type { EmailMessage } from '../src/email-sender';
import { PermanentError } from '../src/engine/retry';
import type { FcmServiceAccount } from '../src/fcm';
import { deployBundle, forgetUser, ingestEvent, sweepMaintenance } from '../src/host/ingest';
import {
  defineConfig,
  emailTemplate,
  event,
  performed,
  pushTemplate,
  trigger,
  workflow,
} from '../src/index';
import type { JourneyStore } from '../src/store/index';
import type { PostgresJourneyStore } from '../src/store/postgres';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/** An email transport that accepts every email: these hosts are not about delivery. */
const quietTransport = { send: async () => ({}) };

/**
 * journeyLambda end to end on the official local durable runner: an HTTP request (a Function
 * URL event) enters a user and submits the run as its own execution; the run sends, parks on a
 * callback, is woken by the next request's wake-up, and finalizes — with every step replayed
 * by the real SDK, against a real Postgres (PGlite).
 */

let database: PgliteDatabase;
let pg: PgliteDatabase['pg'];

beforeAll(async () => {
  database = await pgliteDatabase();
  pg = database.pg;
  await LocalDurableTestRunner.setupTestEnvironment();
}, 30_000);

afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
  await database.close();
});

beforeEach(async () => {
  await truncateAll(pg);
});

const e = event<{ login: Record<string, never>; purchase: { value: number } }>();
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    transactional: true,
    from: { email: 'hi@acme.test', name: 'Acme' },
    title: 'Welcome',
    props: z.strictObject({}),
    subject: 'Welcome aboard',
    preview: {},
    component: () => createElement('p', null, 'Hi'),
  }),
  thanks: emailTemplate({
    id: 'thanks',
    transactional: true,
    from: 'hi@acme.test',
    title: 'Thanks',
    props: z.strictObject({}),
    subject: 'Thanks for buying',
    preview: {},
    component: () => createElement('p', null, 'Thanks'),
  }),
};

function journeyConfig(timeout: '1 day' | '2 seconds') {
  const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) })
    .email(emails.welcome, {})
    .waitUntil(performed(e.purchase), { timeout, onTimeout: 'exit' })
    .email(emails.thanks, {});
  return defineConfig({ workflows: [flow], templates: { email: emails } });
}

/** A Lambda control plane that records what the adapter asks of it. */
function fakeLambda() {
  const starts: { target: string; name: string; payload: string }[] = [];
  const completed: string[] = [];
  const lambda: LambdaApi = {
    async startExecution(input) {
      starts.push(input);
      return { arn: `arn:aws:lambda:us-east-1:1:function:f:1/durable-execution/${input.name}` };
    },
    async completeCallback(callbackId) {
      completed.push(callbackId);
      return true;
    },
    async executionState() {
      return 'running';
    },
    async findExecution() {
      return undefined;
    },
    async stopExecution() {
      return true;
    },
  };
  return { lambda, starts, completed };
}

function setup(
  timeout: '1 day' | '2 seconds' = '1 day',
  onSend: (message: EmailMessage) => Promise<void> = async () => {}
) {
  const sent: EmailMessage[] = [];
  const control = fakeLambda();
  const journeys = journeyLambda({
    config: journeyConfig(timeout),
    env: { ENVIRONMENT: 'production', API_TOKEN: 'secret' },
    store: () => ({ store: database.store, close: async () => {} }),
    email: () => ({
      async send(message) {
        sent.push(message);
        await onSend(message);
        return { providerMessageId: `m${sent.length}` };
      },
    }),
    lambda: control.lambda,
  });
  return { journeys, sent, ...control };
}

function request(path: string, body?: unknown, method = 'POST'): FunctionUrlEvent {
  return {
    version: '2.0',
    rawPath: path,
    rawQueryString: '',
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body), isBase64Encoded: false }),
    requestContext: { domainName: 'abc.lambda-url.us-east-1.on.aws', http: { method } },
  };
}

async function call(handler: ReturnType<typeof setup>['journeys']['handler'], payload: unknown) {
  const runner = new LocalDurableTestRunner({ handlerFunction: handler });
  const result = await runner.run({ payload });
  return { runner, result };
}

describe('journeyLambda', () => {
  test('a request enters the user and submits the run as an execution of its own', async () => {
    const { journeys, starts } = setup();
    // The routes come from the bundle compiled into this code: deploy it first
    const deployed = await call(journeys.handler, request('/bundle/deploy'));
    expect(deployed.result.getResult()).toMatchObject({ statusCode: 200 });

    const { result } = await call(
      journeys.handler,
      request('/events', { userId: 'u1', event: 'login' })
    );
    const response = result.getResult() as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { started: string[] };
    expect(body.started).toHaveLength(1);

    expect(starts).toHaveLength(1);
    const [start] = starts;
    // The name recorded with the entry: what every retry of this start resends
    const recorded = await database.store.executions.get(body.started[0]);
    expect(start.name).toBe(recorded?.name);
    expect(start.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    // Pinned to this invocation's version (the local runner invokes $LATEST)
    expect(start.target).toBe(
      'arn:aws:lambda:us-east-2:123456789012:function:my-function-name:$LATEST'
    );
    const input = JSON.parse(start.payload) as RunInput;
    expect(input).toMatchObject({ type: RUN_EVENT_TYPE, instanceId: body.started[0] });
  });

  test('an HTTP body shaped like a run is still an HTTP request', async () => {
    const { journeys, starts } = setup();
    const forged = request('/events', {
      type: RUN_EVENT_TYPE,
      instanceId: 'x',
      params: {},
      enteredAtMs: 0,
    });
    const { result } = await call(journeys.handler, { ...forged, headers: {} });
    expect(result.getResult()).toMatchObject({ statusCode: 401 });
    expect(starts).toEqual([]);
  });

  test('a run parks on a callback, the next event wakes it, and it finishes', async () => {
    const { journeys, starts, completed, sent } = setup();
    await call(journeys.handler, request('/bundle/deploy'));
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    const run = JSON.parse(starts[0].payload) as RunInput;

    const runner = new LocalDurableTestRunner({
      handlerFunction: (...args) => journeys.handler(...args),
    });
    const running = runner.run({ payload: run });

    // Parked: the callback is armed in Postgres, and the welcome email went out once
    const callback = runner.getOperation('1:subscribe:0:callback');
    await callback.waitForData(WaitingOperationStatus.STARTED);
    // The last step before the wait parks: past it, the check has already run
    await runner.getOperation('1:remaining:0').waitForData(WaitingOperationStatus.COMPLETED);
    const armed = await database.store.executions.get(run.instanceId);
    expect(armed?.callbackId).toBe(callback.getCallbackDetails()?.callbackId);
    expect(armed?.submittedAt).toBeTypeOf('number');
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard']);
    expect(sent[0].from).toEqual({ email: 'hi@acme.test', name: 'Acme' });
    const entry = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
    expect(entry.rows).toEqual([{ status: 'running' }]);

    // The purchase wakes exactly the armed callback; the local runner delivers it
    await call(
      journeys.handler,
      request('/events', { userId: 'u1', event: 'purchase', payload: { value: 1 } })
    );
    expect(completed).toEqual([armed?.callbackId]);
    await callback.sendCallbackSuccess('{}');

    const result = await running;
    expect(result.getResult()).toMatchObject({ status: 'completed' });
    // Replays after the wake did not send the welcome again
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard', 'Thanks for buying']);
    const finished = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
    expect(finished.rows).toEqual([{ status: 'completed' }]);
    const left = await database.store.executions.get(run.instanceId);
    expect(left?.callbackId).toBeUndefined();
    const subscriptions = await pg.query(`SELECT * FROM workflow.subscription`);
    expect(subscriptions.rows).toEqual([]);
  }, 30_000);

  test('a condition met before the wait parks closes its unused callback', async () => {
    // The purchase lands with the welcome email, before the wait arms: its first check finds it
    const { journeys, starts, completed, sent } = setup('1 day', async (message) => {
      if (message.subject !== 'Welcome aboard') return;
      await pg.query(
        `INSERT INTO workflow.event (id, event_id, user_id, name, ts, payload) VALUES ('0190a3b8-0000-7000-8000-000000000001', 'p1', 'u1', 'purchase', now() + interval '1 minute', '{"value":1}')`
      );
    });
    await call(journeys.handler, request('/bundle/deploy'));
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    const run = JSON.parse(starts[0].payload) as RunInput;

    const runner = new LocalDurableTestRunner({
      handlerFunction: (...args) => journeys.handler(...args),
    });
    const result = await runner.run({ payload: run });
    expect(result.getResult()).toMatchObject({ status: 'completed' });
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard', 'Thanks for buying']);
    // Closed through the public callback API rather than left open until it times out
    const callback = runner.getOperation('1:subscribe:0:callback');
    expect(completed).toEqual([callback.getCallbackDetails()?.callbackId]);
  }, 30_000);

  test("the callback's own expiry is the wait's timeout", async () => {
    const { journeys, starts, sent } = setup('2 seconds');
    await call(journeys.handler, request('/bundle/deploy'));
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    const { result } = await call(journeys.handler, JSON.parse(starts[0].payload));
    expect(result.getResult()).toMatchObject({ status: 'exited' });
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard']);
    const entry = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
    expect(entry.rows).toEqual([{ status: 'exited' }]);
  }, 30_000);

  test('/deploy of an arbitrary bundle is refused: only published code routes', async () => {
    const { journeys } = setup();
    const { result } = await call(journeys.handler, request('/deploy', { workflows: [] }));
    expect(result.getResult()).toMatchObject({ statusCode: 409 });
  });
});

describe('AwsInstances', () => {
  function instances(lambda: LambdaApi, now = () => Date.now()) {
    const store = database.store;
    return {
      store,
      port: new AwsInstances({
        store,
        executions: store.executions,
        lambda,
        target: async () => 'arn:aws:lambda:us-east-1:1:function:f:7',
        now,
      }),
    };
  }

  const params = {
    workflowId: 'w',
    contentHash: 'h',
    userId: 'u1',
    trigger: { event: 'login', payload: {} },
  };

  test('a lost submit keeps the entry; the retry resends the same name and payload', async () => {
    const sentStarts: { name: string; payload: string }[] = [];
    let failing = true;
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async startExecution(input) {
        sentStarts.push(input);
        if (failing) throw new Error('socket hang up');
        return {};
      },
    };
    const { store, port } = instances(lambda);
    const ts = Date.now();
    const execution = await port.plan({ id: 'i1', params, ts });
    expect(
      await store.enterJourney({
        workflow: 'w',
        userId: 'u1',
        instanceId: 'i1',
        hash: 'h',
        ts,
        execution,
      })
    ).toBe('entered');
    await expect(port.create({ id: 'i1', params })).rejects.toThrow(/socket hang up/);

    // The entry blocks a second entry, and the pending start is what a retry finishes
    expect(
      await store.enterJourney({
        workflow: 'w',
        userId: 'u1',
        instanceId: 'i2',
        hash: 'h',
        ts: ts + 1,
      })
    ).toBeNull();
    failing = false;
    await port.resume({ workflow: 'w', userId: 'u1' });
    expect(sentStarts).toHaveLength(2);
    expect(sentStarts[1]).toEqual(sentStarts[0]);
    expect((await store.executions.get('i1'))?.submittedAt).toBeTypeOf('number');
    // Confirmed: nothing is pending any more
    await port.resume({ workflow: 'w', userId: 'u1' });
    expect(sentStarts).toHaveLength(2);
  });

  test('past the retry budget a start is unresolved, never restarted', async () => {
    const sentStarts: unknown[] = [];
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async startExecution(input) {
        sentStarts.push(input);
        return {};
      },
    };
    // The budget runs from when the start was recorded, not from the event's ts
    const { store, port } = instances(lambda, () => Date.now() + 13 * 3_600_000);
    const execution = await port.plan({ id: 'i1', params, ts: 1000 });
    await store.enterJourney({
      workflow: 'w',
      userId: 'u1',
      instanceId: 'i1',
      hash: 'h',
      ts: 1000,
      execution,
    });
    await port.maintain();
    expect(sentStarts).toEqual([]);
    expect((await store.executions.get('i1'))?.unresolvedAt).toBeTypeOf('number');
  });

  test('a wake goes to the armed callback; a closed one or none is nothing to do', async () => {
    const control = fakeLambda();
    const { store, port } = instances(control.lambda);
    const execution = await port.plan({ id: 'i1', params, ts: 1000 });
    await store.enterJourney({
      workflow: 'w',
      userId: 'u1',
      instanceId: 'i1',
      hash: 'h',
      ts: 1000,
      execution,
    });
    const instance = await port.get('i1');
    await instance.sendEvent({ type: 'wake', payload: { event: 'purchase' } });
    expect(control.completed).toEqual([]);

    expect(await store.executions.armCallback('i1', { id: 'cb2', generation: 2 })).toBe(true);
    // An older wait's arm, retried late, cannot replace the newer callback
    expect(await store.executions.armCallback('i1', { id: 'cb1', generation: 1 })).toBe(false);
    await instance.sendEvent({ type: 'wake', payload: { event: 'purchase' } });
    expect(control.completed).toEqual(['cb2']);
    // Cleanup of the older generation leaves the newer one armed
    await store.executions.clearCallback('i1', 1);
    expect((await store.executions.get('i1'))?.callbackId).toBe('cb2');

    await expect(port.get('nope')).rejects.toThrow(/no such instance/);
  });

  test('maintenance records an execution the platform ended as failed', async () => {
    const control = fakeLambda();
    const lambda: LambdaApi = { ...control.lambda, executionState: async () => 'timed_out' };
    const { store, port } = instances(lambda, () => 10 * 3_600_000);
    const execution = await port.plan({ id: 'i1', params, ts: 1000 });
    await store.enterJourney({
      workflow: 'w',
      userId: 'u1',
      instanceId: 'i1',
      hash: 'h',
      ts: 1000,
      execution,
    });
    await store.executions.markSubmitted('i1', 'arn:x', 2000);
    await port.maintain();
    const entry = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
    expect(entry.rows).toEqual([{ status: 'failed' }]);
  });

  test('execution names stay valid, and differ per instance and per attempt', () => {
    const long = `${'w'.repeat(32)}-abcdef12-${'u'.repeat(24)}-xyz-lmn123`;
    const name = executionName(long, 'a1b2c3d4');
    expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(executionName(long, 'a1b2c3d4')).toBe(name);
    // A cut prefix never makes two instances collide
    expect(executionName(`${long}x`, 'a1b2c3d4')).not.toBe(name);
    // A new attempt of the same instance gets a new execution
    expect(executionName(long, 'e5f6a7b8')).not.toBe(name);
    expect(executionName('short-id', 'a1b2c3d4')).toMatch(/^short-id-\w+-a1b2c3d4$/);
  });
});

const runParams = {
  workflowId: 'welcome',
  contentHash: 'h',
  userId: 'u1',
  trigger: { event: 'login', payload: {} },
};

describe('the router on AwsInstances', () => {
  const TARGET = 'arn:aws:lambda:us-east-1:1:function:f:7';

  async function routed(lambda: LambdaApi, now?: () => number) {
    const store = database.store;
    const port = new AwsInstances({
      store,
      executions: store.executions,
      lambda,
      target: async () => TARGET,
      ...(now === undefined ? {} : { now }),
    });
    const env = { JOURNEY: port };
    await deployBundle(env, compileConfig(journeyConfig('1 day')), store);
    return { store, port, env };
  }

  test("a failed submit keeps the entry; the user's next event finishes the same start", async () => {
    const control = fakeLambda();
    let failing = true;
    const lambda: LambdaApi = {
      ...control.lambda,
      async startExecution(input) {
        control.starts.push(input);
        if (failing) throw new Error('socket hang up');
        return { arn: 'arn:exec:1' };
      },
    };
    const { store, env } = await routed(lambda);
    await expect(ingestEvent(env, { userId: 'u1', event: 'login' }, store)).rejects.toThrow(
      /socket hang up/
    );
    const entries = await pg.query<{ instance_id: string; status: string }>(
      `SELECT instance_id, status FROM workflow.entry`
    );
    expect(entries.rows).toEqual([{ instance_id: expect.any(String), status: 'running' }]);

    failing = false;
    // A later event: no second entry, and the recorded start is resent as it was
    const again = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    expect(again.started).toEqual([]);
    expect(control.starts).toHaveLength(2);
    expect(control.starts[1]).toEqual(control.starts[0]);
    const record = await store.executions.get(entries.rows[0].instance_id);
    expect(record).toMatchObject({ arn: 'arn:exec:1', submittedAt: expect.any(Number) });
  });

  test('erasing a user stops the execution, waits for its invocation to drain, then erases', async () => {
    const control = fakeLambda();
    const stopped: string[] = [];
    const lambda: LambdaApi = {
      ...control.lambda,
      async stopExecution(arn) {
        stopped.push(arn);
        return true;
      },
    };
    let clock = Date.now();
    const { store, env } = await routed(lambda, () => clock);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    const name = (await store.executions.get(started[0]))?.name ?? '';
    // The run admitted itself (its first act): from here on the erasure has to stop it
    expect(await store.admitInstance(started[0], 'u1')).toBe(true);

    // Stopped, but an invocation running at the stop goes on to its next checkpoint
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: false, pending: started });
    expect(stopped).toEqual([expect.stringContaining(name)]);
    expect(await store.executions.get(started[0])).toMatchObject({ stoppedAt: clock });

    // Within the drain: still pending, and not stopped a second time
    clock += 5 * 60_000;
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: false });
    expect(stopped).toHaveLength(1);

    clock += 11 * 60_000;
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: true, pending: [] });
    expect(await store.executions.get(started[0])).toBeUndefined();
  });

  test('a start whose run never admitted itself is erased at once, without a stop', async () => {
    const stopped: string[] = [];
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async stopExecution(arn) {
        stopped.push(arn);
        return true;
      },
    };
    const { store, env } = await routed(lambda);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    // Nothing of it ran: the tombstone commits first, and the run's admission is refused (the
    // registry guard refuses it too, its start no longer recorded)
    expect(await forgetUser(env, 'u1', store)).toEqual({ ok: true, erased: true, pending: [] });
    expect(stopped).toEqual([]);
    expect(await store.executions.get(started[0])).toBeUndefined();
    expect(await store.admitInstance(started[0], 'u1')).toBe(false);
  });

  test('an execution that already finished on its own is erased at once', async () => {
    const stopped: string[] = [];
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      executionState: async () => 'succeeded',
      async stopExecution(arn) {
        stopped.push(arn);
        return true;
      },
    };
    const { store, env } = await routed(lambda);
    await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: true });
    expect(stopped).toEqual([]);
  });

  test('an execution that will not stop leaves the erasure pending, data untouched', async () => {
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async stopExecution() {
        throw new Error('AccessDeniedException');
      },
    };
    const { store, env } = await routed(lambda);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    expect(await store.admitInstance(started[0], 'u1')).toBe(true);
    const result = await forgetUser(env, 'u1', store);
    expect(result).toMatchObject({ erased: false, pending: started });
    expect(await store.executions.get(started[0])).toBeDefined();
    expect(await store.pendingErasures()).toEqual(['u1']);
  });

  test('stopping a start never confirmed: no retry may submit it, and one that landed is stopped', async () => {
    const control = fakeLambda();
    const stopped: string[] = [];
    const lambda: LambdaApi = {
      ...control.lambda,
      async startExecution() {
        throw new Error('timeout');
      },
      async findExecution(_target, name) {
        return `arn:found:${name}`;
      },
      async stopExecution(arn) {
        stopped.push(arn);
        return true;
      },
    };
    const { store, port, env } = await routed(lambda);
    await expect(ingestEvent(env, { userId: 'u1', event: 'login' }, store)).rejects.toThrow(
      /timeout/
    );
    const [{ instance_id: id }] = (
      await pg.query<{ instance_id: string }>(`SELECT instance_id FROM workflow.entry`)
    ).rows;
    // Stopped, and draining: the terminate reports it is not done yet
    await expect((await port.get(id)).terminate?.()).rejects.toThrow(/may still be finishing/);
    const record = await store.executions.get(id);
    expect(record?.unresolvedAt).toBeTypeOf('number');
    expect(record?.arn).toBe(`arn:found:${record?.name}`);
    expect(stopped).toEqual([`arn:found:${record?.name}`]);
    expect(await store.executions.pendingStarts({ limit: 10 })).toEqual([]);
  });

  test("status speaks the router's vocabulary", async () => {
    let state: Awaited<ReturnType<LambdaApi['executionState']>> = 'running';
    const lambda: LambdaApi = { ...fakeLambda().lambda, executionState: async () => state };
    let clock = Date.now();
    const { store, port, env } = await routed(lambda, () => clock);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    const instance = await port.get(started[0]);
    const statuses: string[] = [];
    for (const next of ['running', 'succeeded', 'failed', 'timed_out', undefined] as const) {
      state = next;
      statuses.push((await instance.status?.())?.status ?? '?');
    }
    expect(statuses).toEqual(['running', 'complete', 'errored', 'terminated', 'terminated']);

    // A stop seen here first is dated now, and running until its drain has passed; the record
    // does not drift with each look
    state = 'stopped';
    expect(await instance.status?.()).toEqual({ status: 'running' });
    expect(await store.executions.get(started[0])).toMatchObject({ stoppedAt: clock });
    clock += 14 * 60_000;
    expect(await instance.status?.()).toEqual({ status: 'running' });
    clock += 60_000;
    expect(await instance.status?.()).toEqual({ status: 'terminated' });
    expect((await store.executions.get(started[0]))?.stoppedAt).toBe(clock - 15 * 60_000);
  });

  test('a running execution is only marked checked, and not looked at again too soon', async () => {
    let clock = 1_000_000_000_000;
    const looked: string[] = [];
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async executionState(arn) {
        looked.push(arn);
        return 'running';
      },
    };
    const { store, port, env } = await routed(lambda, () => clock);
    await ingestEvent(env, { userId: 'u1', event: 'login', ts: clock }, store);
    clock += 20 * 60_000;
    await port.maintain();
    expect(looked).toHaveLength(1);
    const entry = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
    expect(entry.rows).toEqual([{ status: 'running' }]);
    clock += 60_000;
    await port.maintain();
    expect(looked).toHaveLength(1);
  });

  test("a reclaimed entry's new start replaces the old one as what is pending", async () => {
    const { store, port } = await routed({
      ...fakeLambda().lambda,
      async startExecution() {
        throw new Error('down');
      },
    });
    const ts = Date.now();
    const first = await port.plan({ id: 'old', params: runParams, ts });
    await store.enterJourney({
      workflow: 'welcome',
      userId: 'u1',
      instanceId: 'old',
      hash: 'h',
      ts,
      execution: first,
    });
    await store.setEntryStatus('old', 'failed');
    const second = await port.plan({ id: 'new', params: runParams, ts: ts + 1 });
    expect(
      await store.enterJourney({
        workflow: 'welcome',
        userId: 'u1',
        instanceId: 'new',
        hash: 'h',
        ts: ts + 1,
        execution: second,
      })
    ).toBe('reclaimed');
    const pending = await store.executions.pendingStarts({
      workflow: 'welcome',
      userId: 'u1',
      limit: 10,
    });
    expect(pending.map((record) => record.instanceId)).toEqual(['new']);
  });
});

describe('every stop judgment obeys one drain', () => {
  const TARGET = 'arn:aws:lambda:us-east-1:1:function:f:7';
  const DRAIN = 900_000;
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  /**
   * A control plane that remembers each execution's state: a stop makes it `stopped`, as the
   * platform reports one, and a test may set a state by hand (a natural end, an operator's stop).
   */
  function platform() {
    const states = new Map<string, Awaited<ReturnType<LambdaApi['executionState']>>>();
    const stopped: string[] = [];
    const control = fakeLambda();
    const lambda: LambdaApi = {
      ...control.lambda,
      async executionState(arn) {
        return states.get(arn) ?? 'running';
      },
      async stopExecution(arn) {
        stopped.push(arn);
        states.set(arn, 'stopped');
        return true;
      },
    };
    return { lambda, states, stopped, starts: control.starts };
  }

  async function host(options: {
    lambda: LambdaApi;
    now: () => number;
    executions?: (
      registry: PostgresJourneyStore['executions']
    ) => PostgresJourneyStore['executions'];
    reconcileEveryMs?: number;
  }) {
    const store = database.store;
    const port = new AwsInstances({
      store,
      executions: options.executions?.(store.executions) ?? store.executions,
      lambda: options.lambda,
      target: async () => TARGET,
      now: options.now,
      stopDrainMs: DRAIN,
      ...(options.reconcileEveryMs === undefined
        ? {}
        : { reconcileEveryMs: options.reconcileEveryMs }),
    });
    const env = { JOURNEY: port };
    await deployBundle(env, compileConfig(journeyConfig('1 day')), store);
    const entry = async (userId: string) =>
      (
        await pg.query<{ status: string }>(`SELECT status FROM workflow.entry WHERE user_id = $1`, [
          userId,
        ])
      ).rows.map((row) => row.status);
    /** An admitted start of the user: what the erasure has to stop. */
    const admitted = async (userId: string) => {
      const { started } = await ingestEvent(env, { userId, event: 'login' }, store);
      expect(await store.admitInstance(started[0], 'u1' === userId ? 'u1' : userId)).toBe(true);
      const arn = (await store.executions.get(started[0]))?.arn ?? '';
      return { id: started[0], arn };
    };
    return { store, port, env, entry, admitted, sweep: () => sweepMaintenance(env, store) };
  }

  test('the erasure waits out the drain through every sweep, then completes, and stays done', async () => {
    const warned = quiet();
    try {
      const control = platform();
      let clock = 1_700_000_000_000;
      const h = await host({ lambda: control.lambda, now: () => clock });
      const { id } = await h.admitted('u1');
      const stoppedAt = clock;
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({
        erased: false,
        pending: [id],
      });
      expect(await h.store.executions.get(id)).toMatchObject({ stoppedAt });

      // A full sweep a second later: maintenance sees the platform's STOPPED, and keeps the
      // entry running for the erasure to wait on
      clock += 1_000;
      await h.sweep();
      expect(await h.store.erasureState('u1')).toBe('erasing');
      expect(await h.entry('u1')).toEqual(['running']);
      expect(await h.store.executions.get(id)).toMatchObject({ stoppedAt, checkedAt: clock });
      expect(control.stopped).toHaveLength(1);

      clock = stoppedAt + DRAIN - 1;
      await h.sweep();
      expect(await h.store.erasureState('u1')).toBe('erasing');
      expect(await h.entry('u1')).toEqual(['running']);
      expect((await h.store.executions.get(id))?.stoppedAt).toBe(stoppedAt);

      clock = stoppedAt + DRAIN;
      await h.sweep();
      expect(await h.store.erasureState('u1')).toBe('erased');
      expect(await h.entry('u1')).toEqual([]);
      expect(await h.store.executions.get(id)).toBeUndefined();

      clock += DRAIN;
      await h.sweep();
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({ erased: true, pending: [] });
      expect(control.stopped).toHaveLength(1);
    } finally {
      warned.mockRestore();
    }
  });

  test('a reconcile that read its record before another path stopped it judges the fresh record', async () => {
    const warned = quiet();
    try {
      const control = platform();
      let clock = 1_700_000_000_000;
      let interposed = false;
      const lambda: LambdaApi = {
        ...control.lambda,
        async executionState(arn) {
          // The sweep's reconcile has its snapshot (stoppedAt: none); an erasure stops the
          // execution now, before the reconcile reads the platform's state
          if (!interposed) {
            interposed = true;
            await forgetUser(h.env, 'u1', h.store);
          }
          return control.states.get(arn) ?? 'running';
        },
      };
      const h = await host({ lambda, now: () => clock, reconcileEveryMs: 0 });
      const { id } = await h.admitted('u1');
      clock += 1_000;
      await h.port.maintain();
      expect(interposed).toBe(true);
      expect(control.stopped).toHaveLength(1);
      // Not finalized on the stale record: the stop is in the drain
      expect(await h.entry('u1')).toEqual(['running']);
      expect(await h.store.executions.get(id)).toMatchObject({ stoppedAt: clock });
      expect(await h.store.erasureState('u1')).toBe('erasing');

      // Past the drain the reconcile finalizes, as it always did, and the erasure completes
      clock += DRAIN;
      await h.port.maintain();
      expect(await h.entry('u1')).toEqual(['failed']);
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({ erased: true });
    } finally {
      warned.mockRestore();
    }
  });

  test('STOPPED before the stop is recorded: not stopped until the time lands, then one drain from it', async () => {
    const warned = quiet();
    try {
      const control = platform();
      let clock = 1_700_000_000_000;
      let failing = true;
      const h = await host({
        lambda: control.lambda,
        now: () => clock,
        executions: (registry) =>
          new Proxy(registry, {
            get(target, property) {
              if (property !== 'markStopped') return Reflect.get(target, property, target);
              return async (instanceId: string, at: number) => {
                if (failing) throw new Error('connection terminated unexpectedly');
                return target.markStopped(instanceId, at);
              };
            },
          }),
        reconcileEveryMs: 0,
      });
      const { id, arn } = await h.admitted('u1');
      // Stopped by an operator: the platform says so before any record of it
      control.states.set(arn, 'stopped');

      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({
        erased: false,
        pending: [id],
      });
      expect(control.stopped).toEqual([]);
      expect((await h.store.executions.get(id))?.stoppedAt).toBeUndefined();
      // Maintenance cannot date the stop either: nothing is finalized
      await expect(h.port.maintain()).rejects.toThrow(/connection terminated/);
      expect(await h.entry('u1')).toEqual(['running']);
      expect(await h.store.pendingErasures()).toEqual(['u1']);

      // The write recovers: the first sighting is dated now, and the drain runs from it
      failing = false;
      clock += 5_000;
      const sighted = clock;
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({
        erased: false,
        pending: [id],
      });
      expect(await h.store.executions.get(id)).toMatchObject({ stoppedAt: sighted });
      expect(control.stopped).toEqual([]);

      clock += 60_000;
      await h.sweep();
      expect(await h.store.erasureState('u1')).toBe('erasing');
      expect(await h.entry('u1')).toEqual(['running']);
      expect((await h.store.executions.get(id))?.stoppedAt).toBe(sighted);

      clock = sighted + DRAIN;
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({ erased: true, pending: [] });
      expect(await h.store.executions.get(id)).toBeUndefined();
    } finally {
      warned.mockRestore();
    }
  });

  test('a start never admitted is cancelled at once; natural ends and other users are as before', async () => {
    const warned = quiet();
    try {
      const control = platform();
      let clock = 1_700_000_000_000;
      const h = await host({ lambda: control.lambda, now: () => clock, reconcileEveryMs: 0 });
      // u1: admitted and stopped, in its drain
      const u1 = await h.admitted('u1');
      expect(await forgetUser(h.env, 'u1', h.store)).toMatchObject({ erased: false });
      // u2: admitted, and finished on its own
      const u2 = await h.admitted('u2');
      control.states.set(u2.arn, 'succeeded');
      // u3: never admitted
      const { started: u3 } = await ingestEvent(h.env, { userId: 'u3', event: 'login' }, h.store);
      // u4: admitted, failed on its own; the sweep records it without any drain
      const u4 = await h.admitted('u4');
      control.states.set(u4.arn, 'failed');

      clock += 1_000;
      expect(await forgetUser(h.env, 'u2', h.store)).toMatchObject({ erased: true, pending: [] });
      expect(await forgetUser(h.env, 'u3', h.store)).toMatchObject({ erased: true, pending: [] });
      expect(control.stopped).toEqual([u1.arn]);
      expect(await h.store.executions.get(u3[0])).toBeUndefined();
      await h.sweep();
      expect(await h.entry('u4')).toEqual(['failed']);
      expect((await h.store.executions.get(u4.id))?.stoppedAt).toBeUndefined();
      // u1 is still draining, its data untouched
      expect(await h.store.erasureState('u1')).toBe('erasing');
      expect(await h.entry('u1')).toEqual(['running']);
      expect(await h.store.executions.get(u1.id)).toMatchObject({ stoppedAt: clock - 1_000 });
    } finally {
      warned.mockRestore();
    }
  });
});

describe('journeyLambda entry points', () => {
  const saved = process.env.AWS_LAMBDA_FUNCTION_VERSION;
  afterEach(() => {
    if (saved === undefined) delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
    else process.env.AWS_LAMBDA_FUNCTION_VERSION = saved;
  });

  test('the sweep event runs maintenance and the segment sweep', async () => {
    const control = fakeLambda();
    let failing = true;
    const journeys = journeyLambda({
      email: () => quietTransport,
      config: journeyConfig('1 day'),
      env: { API_TOKEN: 'secret' },
      store: () => database.store,
      lambda: {
        ...control.lambda,
        async startExecution(input) {
          control.starts.push(input);
          if (failing) throw new Error('down');
          return {};
        },
      },
    });
    await call(journeys.handler, request('/bundle/deploy'));
    const failed = await call(
      journeys.handler,
      request('/events', { userId: 'u1', event: 'login' })
    );
    expect(failed.result.getResult()).toMatchObject({ statusCode: 500 });
    // Old enough for maintenance to pick it up
    await pg.query(`UPDATE workflow.execution SET created_at = now() - interval '5 minutes'`);
    failing = false;
    const { result } = await call(journeys.handler, { type: SWEEP_EVENT_TYPE });
    expect(result.getResult()).toMatchObject({ users: 1, started: [] });
    expect(control.starts).toHaveLength(2);
    expect(control.starts[1]).toEqual(control.starts[0]);
  });

  test('an event that is neither a request, a run nor a sweep fails the execution', async () => {
    const { journeys } = setup();
    const { result } = await call(journeys.handler, { hello: 'world' });
    expect(result.getError().errorMessage).toMatch(/unrecognized event/);
  });

  test('a numbered version makes its own bundle live and pins new executions to itself', async () => {
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '3';
    const { journeys, starts } = setup();
    // No POST /bundle/deploy: the first request applies the bundle compiled into version 3
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    expect(starts.map((s) => s.target)).toEqual([
      'arn:aws:lambda:us-east-2:123456789012:function:my-function-name:3',
    ]);
    const live = await pg.query<{ version_id: string }>(
      `SELECT version_id FROM workflow.deployment`
    );
    expect(live.rows).toEqual([{ version_id: '3' }]);
  });

  test("an older version still serving starts the live routes' workflows on the version that owns them", async () => {
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '3';
    const newer = setup();
    await call(newer.journeys.handler, request('/events', { userId: 'u0', event: 'login' }));

    // Version 2 carries another bundle (its welcome differs): it must not run version 3's IR
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '2';
    const control = fakeLambda();
    const older = journeyLambda({
      email: () => quietTransport,
      config: defineConfig({
        workflows: [
          workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(emails.thanks, {}),
        ],
        templates: { email: emails },
      }),
      env: { API_TOKEN: 'secret' },
      store: () => database.store,
      lambda: control.lambda,
    });
    await call(older.handler, request('/events', { userId: 'u1', event: 'login' }));
    expect(control.starts.map((s) => s.target)).toEqual([
      'arn:aws:lambda:us-east-2:123456789012:function:my-function-name:3',
    ]);
    // Nor put its own routes back over the newer version's
    const live = await pg.query<{ version_id: string }>(
      `SELECT version_id FROM workflow.deployment`
    );
    expect(live.rows).toEqual([{ version_id: '3' }]);
  });

  test('a delay is a durable wait, and the step before it is not repeated after', async () => {
    const sent: EmailMessage[] = [];
    const control = fakeLambda();
    const flow = workflow({ id: 'later', trigger: trigger.event(e.login) })
      .email(emails.welcome, {})
      .delay('2 seconds')
      .email(emails.thanks, {});
    const journeys = journeyLambda({
      config: defineConfig({ workflows: [flow], templates: { email: emails } }),
      env: { API_TOKEN: 'secret' },
      store: () => database.store,
      email: () => ({
        async send(message) {
          sent.push(message);
          return {};
        },
      }),
      lambda: control.lambda,
    });
    await call(journeys.handler, request('/bundle/deploy'));
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    const startedAt = Date.now();
    const { result } = await call(journeys.handler, JSON.parse(control.starts[0].payload));
    expect(result.getResult()).toMatchObject({ status: 'completed' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_900);
    // Resumed after the wait in a new invocation: the welcome was not sent again
    expect(result.getInvocations().length).toBeGreaterThan(1);
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard', 'Thanks for buying']);
  }, 30_000);
});

describe('review fixes', () => {
  const TARGET = 'arn:aws:lambda:us-east-1:1:function:f:7';
  const HOUR = 3_600_000;

  function port(lambda: LambdaApi, now: () => number = Date.now) {
    const store = database.store;
    return {
      store,
      port: new AwsInstances({
        store,
        executions: store.executions,
        lambda,
        target: async () => TARGET,
        now,
      }),
    };
  }

  async function enter(
    store: PostgresJourneyStore,
    instances: AwsInstances,
    id: string,
    ts: number
  ) {
    const execution = await instances.plan({ id, params: runParams, ts });
    await store.enterJourney({
      workflow: 'welcome',
      userId: 'u1',
      instanceId: id,
      hash: 'h',
      ts,
      execution,
    });
  }

  test('an execution not visible yet is left running; one missing past the budget is failed', async () => {
    let clock = Date.now();
    const lambda: LambdaApi = { ...fakeLambda().lambda, findExecution: async () => undefined };
    const { store, port: instances } = port(lambda, () => clock);
    await enter(store, instances, 'i1', clock);
    // Submitted, but the invoke's response named no ARN and the run has not started yet
    await store.executions.markSubmitted('i1', undefined, clock);
    await instances.maintain();
    const status = async () =>
      (await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`)).rows[0].status;
    expect(await status()).toBe('running');
    expect((await store.executions.get('i1'))?.checkedAt).toBe(clock);

    clock += 13 * HOUR;
    await instances.maintain();
    expect(await status()).toBe('failed');
  });

  test('a succeeded or running execution never fails the entry', async () => {
    for (const state of ['running', 'succeeded'] as const) {
      await pg.exec('TRUNCATE workflow.entry, workflow.execution');
      const lambda: LambdaApi = { ...fakeLambda().lambda, executionState: async () => state };
      const { store, port: instances } = port(lambda);
      await enter(store, instances, 'i1', Date.now());
      await store.executions.markSubmitted('i1', 'arn:x', Date.now());
      await instances.maintain();
      const entry = await pg.query<{ status: string }>(`SELECT status FROM workflow.entry`);
      expect(entry.rows).toEqual([{ status: 'running' }]);
    }
  });

  test('stopping an execution not visible yet fails, so the erasure stays pending', async () => {
    let clock = Date.now();
    const lambda: LambdaApi = { ...fakeLambda().lambda, findExecution: async () => undefined };
    const { store, port: instances } = port(lambda, () => clock);
    await enter(store, instances, 'i1', clock);
    await store.executions.markSubmitted('i1', undefined, clock);
    expect(await store.admitInstance('i1', 'u1')).toBe(true);
    const env = { JOURNEY: instances };
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: false, pending: ['i1'] });
    expect(await store.executions.get('i1')).toBeDefined();

    // Past the budget an execution still nowhere to be seen never started: the erasure finishes
    clock += 13 * HOUR;
    expect(await forgetUser(env, 'u1', store)).toMatchObject({ erased: true });
    expect(await store.executions.get('i1')).toBeUndefined();
  });

  test("a backfilled event's old ts neither ages the start nor anchors the instance", async () => {
    const sent: { payload: string }[] = [];
    let failing = true;
    const lambda: LambdaApi = {
      ...fakeLambda().lambda,
      async startExecution(input) {
        sent.push(input);
        if (failing) throw new Error('down');
        return {};
      },
    };
    const { store, port: instances } = port(lambda);
    const env = { JOURNEY: instances };
    await deployBundle(env, compileConfig(journeyConfig('1 day')), store);
    const twoDaysAgo = Date.now() - 48 * HOUR;
    await expect(
      ingestEvent(env, { userId: 'u1', event: 'login', ts: twoDaysAgo }, store)
    ).rejects.toThrow(/down/);
    failing = false;
    await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    // Retried, not given up on: the start is minutes old, whatever the event's ts
    expect(sent).toHaveLength(2);
    const [record] = await pg
      .query<{ unresolved_at: unknown }>(`SELECT unresolved_at FROM workflow.execution`)
      .then((r) => r.rows);
    expect(record.unresolved_at).toBeNull();
    // Anchored when the instance was created, as on Cloudflare
    const input = JSON.parse(sent[0].payload) as RunInput;
    expect(Date.now() - input.enteredAtMs).toBeLessThan(60_000);
  });

  test('a read is answered without a step; a write runs in one', async () => {
    const { journeys } = setup();
    const read = await call(journeys.handler, request('/bundle', undefined, 'GET'));
    expect(read.result.getResult()).toMatchObject({ statusCode: 200 });
    expect(read.result.getOperations()).toEqual([]);
    const write = await call(journeys.handler, request('/bundle/deploy'));
    expect(write.result.getOperations().map((operation) => operation.getName())).toEqual(['http']);
  });
});

describe('second review fixes', () => {
  const saved = process.env.AWS_LAMBDA_FUNCTION_VERSION;
  afterEach(() => {
    if (saved === undefined) delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
    else process.env.AWS_LAMBDA_FUNCTION_VERSION = saved;
  });

  test('a release between reading the routes and planning the start cannot repin the IR', async () => {
    const v3 = journeyConfig('1 day');
    const v4 = defineConfig({
      workflows: [
        workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(emails.thanks, {}),
      ],
      templates: { email: emails },
    });
    const base = database.store;
    await deployBundle({ JOURNEY: {} as never }, compileConfig(v3), base, {
      id: '3',
      createdAt: 3,
    });
    // The routes are read, then version 4 goes live before the start is planned
    let released = false;
    const racing = new Proxy(base, {
      get(target, property) {
        if (property !== 'findTriggers') return Reflect.get(target, property, target);
        return async (event: string) => {
          const routes = await target.findTriggers(event);
          if (!released) {
            released = true;
            await deployBundle({ JOURNEY: {} as never }, compileConfig(v4), target, {
              id: '4',
              createdAt: 4,
            });
          }
          return routes;
        };
      },
    });
    // An older version still serving: neither bundle is its own
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '2';
    const control = fakeLambda();
    const journeys = journeyLambda({
      email: () => quietTransport,
      config: defineConfig({
        workflows: [
          workflow({ id: 'other', trigger: trigger.event(e.purchase) }).email(emails.thanks, {}),
        ],
        templates: { email: emails },
      }),
      env: { API_TOKEN: 'secret' },
      store: () => racing,
      lambda: control.lambda,
    });
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    expect(released).toBe(true);
    const [start] = control.starts;
    const input = JSON.parse(start.payload) as RunInput;
    // Version 3's IR, on version 3: the version came from the same row as the hash
    expect(input.params.contentHash).toBe(compileConfig(v3).workflows[0].contentHash);
    expect(start.target).toBe('arn:aws:lambda:us-east-2:123456789012:function:my-function-name:3');
  });

  test('routes from a forced deploy start only workflows this code carries', async () => {
    const control = fakeLambda();
    const journeys = journeyLambda({
      email: () => quietTransport,
      config: defineConfig({
        workflows: [
          workflow({ id: 'other', trigger: trigger.event(e.purchase) }).email(emails.thanks, {}),
        ],
        templates: { email: emails },
      }),
      env: { API_TOKEN: 'secret' },
      store: () => database.store,
      lambda: control.lambda,
    });
    // Another bundle forced in: no version recorded on its routes
    await deployBundle(
      { JOURNEY: {} as never },
      compileConfig(journeyConfig('1 day')),
      database.store
    );
    const { result } = await call(
      journeys.handler,
      request('/events', { userId: 'u1', event: 'login' })
    );
    expect(result.getResult()).toMatchObject({ statusCode: 500 });
    expect(control.starts).toEqual([]);
  });

  test('a replayed event that reclaims a failed entry starts a new execution', async () => {
    const control = fakeLambda();
    const store = database.store;
    const port = new AwsInstances({
      store,
      executions: store.executions,
      lambda: control.lambda,
      target: async () => 'arn:aws:lambda:us-east-1:1:function:f:7',
    });
    const env = { JOURNEY: port };
    await deployBundle(env, compileConfig(journeyConfig('1 day')), store);
    const ts = Date.now();
    const first = await ingestEvent(env, { id: 'e1', userId: 'u1', event: 'login', ts }, store);
    await store.setEntryStatus(first.started[0], 'failed');

    // The same event again, same ts: the same instance id, reclaimed
    const again = await ingestEvent(env, { id: 'e1', userId: 'u1', event: 'login', ts }, store);
    expect(again.started).toEqual(first.started);
    expect(control.starts).toHaveLength(2);
    // A new name — the old one would only return the closed execution
    expect(control.starts[1].name).not.toBe(control.starts[0].name);
    const record = await store.executions.get(first.started[0]);
    expect(record).toMatchObject({ name: control.starts[1].name, submittedAt: expect.any(Number) });
    expect(record?.callbackId).toBeUndefined();
  });
});

describe('4.0: the run is bound to the registry', () => {
  async function recordedRun() {
    const { journeys, starts, sent } = setup();
    await call(journeys.handler, request('/bundle/deploy'));
    await call(journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    return { journeys, sent, run: JSON.parse(starts[0].payload) as RunInput };
  }

  test('an input that is not byte for byte a recorded start is refused, before any step', async () => {
    const { journeys, sent, run } = await recordedRun();
    const forged: RunInput = { ...run, params: { ...run.params, userId: 'u2' } };
    const { result } = await call(journeys.handler, forged);
    expect(result.getError().errorMessage).toMatch(/not a recorded start/);
    expect(result.getOperations()).toEqual([]);
    expect(sent).toEqual([]);
    // A reordered copy of the same fields is another byte string too
    const reordered = {
      params: run.params,
      instanceId: run.instanceId,
      type: run.type,
      enteredAtMs: run.enteredAtMs,
    };
    const again = await call(journeys.handler, reordered);
    expect(again.result.getError().errorMessage).toMatch(/not a recorded start/);
  });

  test('an instance with no record, or one that was stopped, does not run', async () => {
    const { journeys, sent, run } = await recordedRun();
    const unknown = await call(journeys.handler, { ...run, instanceId: 'never-planned' });
    expect(unknown.result.getError().errorMessage).toMatch(/not a recorded start/);
    await database.store.executions.markStopped(run.instanceId, Date.now());
    const stopped = await call(journeys.handler, run);
    expect(stopped.result.getError().errorMessage).toMatch(/not a recorded start/);
    expect(sent).toEqual([]);
  });
});

describe('4.0: the sweep is resumable, one durable step per page', () => {
  /** A Postgres store with every listUserIds call recorded, and page 0 slowed down by `delayMs`. */
  function pagedStore(delayMs = 0) {
    const pages: (string | undefined)[] = [];
    const store = () => {
      const base = database.store;
      return new Proxy(base, {
        get(target, property, receiver) {
          if (property !== 'listUserIds') return Reflect.get(target, property, receiver);
          return async (page?: { after?: string; limit?: number }) => {
            pages.push(page?.after);
            if (page?.after === undefined && delayMs > 0) {
              await new Promise<void>((resolve) => {
                setTimeout(resolve, delayMs);
              });
            }
            return target.listUserIds(page);
          };
        },
      });
    };
    return { store, pages };
  }

  function sweeper(store: () => JourneyStore) {
    return journeyLambda({
      email: () => quietTransport,
      config: journeyConfig('1 day'),
      env: { API_TOKEN: 'secret' },
      store,
      lambda: fakeLambda().lambda,
    });
  }

  const seedUsers = (count: number) =>
    pg.query(
      `INSERT INTO workflow.profile (user_id, props)
       SELECT 'u' || lpad(i::text, 4, '0'), '{}' FROM generate_series(1, ${count}) i`
    );

  test('501 users are two page steps between maintenance and the snapshot', async () => {
    await seedUsers(501);
    const { store, pages } = pagedStore();
    const { result } = await call(sweeper(store).handler, { type: SWEEP_EVENT_TYPE });
    expect(result.getResult()).toMatchObject({ users: 501, started: [] });
    expect(result.getOperations().map((operation) => operation.getName())).toEqual([
      'sweep:maintain',
      'sweep:page:0',
      'sweep:page:1',
      'sweep:snapshot',
    ]);
    expect(pages).toEqual([undefined, 'u0500']);
  });

  test('an invocation cut short replays its checkpointed pages instead of re-evaluating them', async () => {
    await seedUsers(501);
    const { store, pages } = pagedStore(300);
    const runner = new LocalDurableTestRunner({ handlerFunction: sweeper(store).handler });
    const running = runner.run({ payload: { type: SWEEP_EVENT_TYPE } });
    // Cut the invocation at page 0's checkpoint: the page is kept, the rest replays on resume
    await runner.getOperation('sweep:page:0').waitForData(WaitingOperationStatus.STARTED);
    await runner.pauseExecution();
    await runner.resumeExecution();
    const result = await running;
    expect(result.getResult()).toMatchObject({ users: 501 });
    expect(result.getInvocations().length).toBeGreaterThan(1);
    // Page 0 was listed once across both invocations: the replay took its checkpoint
    expect(pages.filter((after) => after === undefined)).toHaveLength(1);
    expect(pages.filter((after) => after === 'u0500')).toHaveLength(1);
  }, 30_000);
});

describe('the registry read at the entry of a run is retried, briefly, never its verdict', () => {
  /** The store with every `executions.get` counted, and failed when `failNext` says so. */
  function flakyRegistry() {
    const reads: string[] = [];
    let failNext: (() => Error | undefined) | undefined;
    const store = () => {
      const base = database.store;
      const executions = new Proxy(base.executions, {
        get(target, property, receiver) {
          if (property !== 'get') return Reflect.get(target, property, receiver);
          return async (instanceId: string) => {
            reads.push(instanceId);
            const error = failNext?.();
            if (error !== undefined) throw error;
            return target.get(instanceId);
          };
        },
      });
      return new Proxy(base, {
        get(target, property, receiver) {
          if (property === 'executions') return executions;
          return Reflect.get(target, property, receiver);
        },
      });
    };
    return {
      store,
      reads,
      /** Fail the next `count` reads with `error`, then answer normally. */
      failReads: (count: number, error = new Error('transient: connection reset')) => {
        let left = count;
        failNext = () => (left-- > 0 ? error : undefined);
      },
    };
  }

  function host(timeout: '1 day' | '2 seconds' = '1 day') {
    const flaky = flakyRegistry();
    const sent: EmailMessage[] = [];
    const control = fakeLambda();
    const journeys = journeyLambda({
      config: journeyConfig(timeout),
      env: { ENVIRONMENT: 'production', API_TOKEN: 'secret' },
      store: flaky.store,
      email: () => ({
        async send(message) {
          sent.push(message);
          return {};
        },
      }),
      lambda: control.lambda,
    });
    return { ...flaky, journeys, sent, starts: control.starts };
  }

  async function recorded(timeout: '1 day' | '2 seconds' = '1 day') {
    const h = host(timeout);
    await call(h.journeys.handler, request('/bundle/deploy'));
    await call(h.journeys.handler, request('/events', { userId: 'u1', event: 'login' }));
    await pg.query(
      `INSERT INTO workflow.profile (user_id, props) VALUES ('u1', '{"email":"ada@acme.test"}')`
    );
    h.reads.length = 0;
    return { ...h, run: JSON.parse(h.starts[0].payload) as RunInput };
  }

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  test('a read that stumbles once is tried again: the run goes on, its steps once', async () => {
    const warned = quiet();
    try {
      const { journeys, sent, reads, failReads, run } = await recorded('2 seconds');
      failReads(1);
      const { result } = await call((...args) => journeys.handler(...args), run);
      expect(result.getResult()).toMatchObject({ status: 'exited' });
      expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard']);
      // The failed read, its retry, then the wake after the timeout read once more
      expect(reads.slice(0, 2)).toEqual([run.instanceId, run.instanceId]);
      expect(warned).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`run entry: read failed for instance ${run.instanceId} \\(attempt 1 of 3\\)`)
        ),
        expect.any(Error)
      );
    } finally {
      warned.mockRestore();
    }
  }, 30_000);

  test('a stumble on the wake after a wait continues the run without repeating its steps', async () => {
    const warned = quiet();
    try {
      const { journeys, sent, failReads, run } = await recorded();
      const runner = new LocalDurableTestRunner({
        handlerFunction: (...args) => journeys.handler(...args),
      });
      const running = runner.run({ payload: run });
      const callback = runner.getOperation('1:subscribe:0:callback');
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner.getOperation('1:remaining:0').waitForData(WaitingOperationStatus.COMPLETED);
      expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard']);
      await call(
        journeys.handler,
        request('/events', { userId: 'u1', event: 'purchase', payload: { value: 1 } })
      );
      // The wake's invocation: its first read fails, the retry sees the record
      failReads(1);
      await callback.sendCallbackSuccess('{}');
      const result = await running;
      expect(result.getResult()).toMatchObject({ status: 'completed' });
      expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard', 'Thanks for buying']);
    } finally {
      warned.mockRestore();
    }
  }, 30_000);

  test('a stop during the wait is seen on the wake: refused, nothing more sent', async () => {
    const { journeys, sent, run } = await recorded();
    const runner = new LocalDurableTestRunner({
      handlerFunction: (...args) => journeys.handler(...args),
    });
    const running = runner.run({ payload: run });
    const callback = runner.getOperation('1:subscribe:0:callback');
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner.getOperation('1:remaining:0').waitForData(WaitingOperationStatus.COMPLETED);
    await database.store.executions.markStopped(run.instanceId, Date.now());
    await callback.sendCallbackSuccess('{}');
    const result = await running;
    expect(result.getError().errorMessage).toMatch(/not a recorded start/);
    expect(sent.map((m) => m.subject)).toEqual(['Welcome aboard']);
  }, 30_000);

  test('a missing record or a mismatched input is refused on the first read, no retry', async () => {
    const { journeys, sent, reads, run } = await recorded();
    const forged = await call(journeys.handler, {
      ...run,
      params: { ...run.params, userId: 'u2' },
    });
    expect(forged.result.getError().errorMessage).toMatch(/not a recorded start/);
    expect(reads).toEqual([run.instanceId]);
    const unknown = await call(journeys.handler, { ...run, instanceId: 'never-planned' });
    expect(unknown.result.getError().errorMessage).toMatch(/not a recorded start/);
    expect(reads).toEqual([run.instanceId, 'never-planned']);
    expect(sent).toEqual([]);
  });

  test('a database that keeps failing fails the execution after three reads; a permanent error after one', async () => {
    const warned = quiet();
    try {
      const { journeys, sent, reads, failReads, run } = await recorded();
      failReads(Number.POSITIVE_INFINITY);
      const startedAt = Date.now();
      const { result } = await call((...args) => journeys.handler(...args), run);
      expect(result.getError().errorMessage).toMatch(/connection reset/);
      expect(reads).toHaveLength(3);
      // The two pauses between the attempts, and no durable step before the refusal
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(390);
      expect(result.getOperations()).toEqual([]);
      expect(warned).toHaveBeenCalledTimes(2);

      reads.length = 0;
      failReads(Number.POSITIVE_INFINITY, new PermanentError('registry schema is missing'));
      const permanent = await call(journeys.handler, run);
      expect(permanent.result.getError().errorMessage).toMatch(/schema is missing/);
      expect(reads).toHaveLength(1);
      expect(sent).toEqual([]);
    } finally {
      warned.mockRestore();
    }
  });
});

describe('the provider clients live with the host, across invocations', () => {
  /** An APNs stand-in the Lambda's own HTTP/2 fetch reaches (the relay origin): records each bearer. */
  let apns: Http2Server;
  let apnsOrigin: string;
  const apnsAuths: (string | undefined)[] = [];
  let p8Base64: string;
  let serviceAccountBase64: string;
  const fcmTokenCalls: string[] = [];
  const fcmSends: string[] = [];

  beforeAll(async () => {
    apns = createServer((request, response) => {
      apnsAuths.push(request.headers.authorization);
      response.writeHead(200, { 'apns-id': 'id-1' });
      response.end();
    });
    await new Promise<void>((resolve) => {
      apns.listen(0, '127.0.0.1', resolve);
    });
    apnsOrigin = `http://127.0.0.1:${(apns.address() as AddressInfo).port}`;
    const ec = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const ecDer = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', ec.privateKey)).toString(
      'base64'
    );
    p8Base64 = Buffer.from(
      `-----BEGIN PRIVATE KEY-----\n${ecDer}\n-----END PRIVATE KEY-----\n`
    ).toString('base64');
    const rsa = await webcrypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const rsaDer = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', rsa.privateKey)).toString(
      'base64'
    );
    const account: FcmServiceAccount = {
      project_id: 'acme',
      client_email: 'sa@acme.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${rsaDer.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`,
    };
    serviceAccountBase64 = Buffer.from(JSON.stringify(account)).toString('base64');
    // FCM goes through the platform fetch: Google's endpoints are answered here, the rest passes
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href === 'https://oauth2.googleapis.com/token') {
        fcmTokenCalls.push(href);
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (href.startsWith('https://fcm.googleapis.com/')) {
        fcmSends.push(new Headers(init?.headers).get('authorization') ?? '');
        return new Response('{}', { status: 200 });
      }
      return realFetch(input, init);
    });
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve) => {
      apns.close(() => resolve());
    });
  });

  const pushes = {
    nudge: pushTemplate({
      id: 'nudge',
      transactional: true,
      title: 'Nudge',
      props: z.strictObject({}),
      preview: {},
      content: () => ({ title: 'Hi', body: 'come back' }),
    }),
  };

  function pushHost() {
    const control = fakeLambda();
    const flow = workflow({ id: 'nudge', trigger: trigger.event(e.login) }).push(pushes.nudge, {});
    const journeys = journeyLambda({
      config: defineConfig({
        workflows: [flow],
        templates: { push: pushes },
        apns: { topic: 'io.acme.app', keyId: 'KEY1234567', teamId: 'TEAM123456' },
        fcm: {},
      }),
      env: {
        // Not production: production ignores the relay origin, and the stand-in is reached as one
        ENVIRONMENT: 'development',
        API_TOKEN: 'secret',
        APNS_PRIVATE_KEY_BASE64: p8Base64,
        APNS_RELAY_ORIGIN: apnsOrigin,
        GOOGLE_APPLICATION_CREDENTIALS_BASE64: serviceAccountBase64,
      },
      store: () => database.store,
      lambda: control.lambda,
    });
    return { journeys, starts: control.starts };
  }

  /** Enter `userId` with an iOS and an Android device, and run its instance as its own invocation. */
  async function runFor(host: ReturnType<typeof pushHost>, userId: string) {
    const store = database.store;
    await store.upsertDevice({ userId, token: `${userId}-ios`, platform: 'ios', ts: 1 });
    await store.upsertDevice({ userId, token: `${userId}-android`, platform: 'android', ts: 2 });
    const before = host.starts.length;
    await call(host.journeys.handler, request('/events', { userId, event: 'login' }));
    const { result } = await call(
      host.journeys.handler,
      JSON.parse(host.starts[before].payload) as RunInput
    );
    expect(result.getResult()).toMatchObject({ status: 'completed' });
  }

  test('two invocations of one host sign one APNs token and exchange one FCM token; another host signs its own', async () => {
    const host = pushHost();
    await call(host.journeys.handler, request('/bundle/deploy'));
    await runFor(host, 'u1');
    await runFor(host, 'u2');
    expect(apnsAuths).toHaveLength(2);
    expect(apnsAuths[0]).toMatch(/^bearer /);
    // One provider JWT across two invocations, each with its own run env
    expect(apnsAuths[1]).toBe(apnsAuths[0]);
    expect(fcmTokenCalls).toHaveLength(1);
    expect(fcmSends).toEqual(['Bearer at', 'Bearer at']);

    // Another host instance (a cold start): its own clients, its own tokens
    const other = pushHost();
    await runFor(other, 'u3');
    expect(apnsAuths).toHaveLength(3);
    expect(apnsAuths[2]).not.toBe(apnsAuths[0]);
    expect(fcmTokenCalls).toHaveLength(2);
  }, 60_000);
});
