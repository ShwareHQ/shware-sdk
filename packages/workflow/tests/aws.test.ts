import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from '@aws/durable-execution-sdk-js-testing';
import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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
import { deployBundle, forgetUser, ingestEvent } from '../src/host/router';
import { defineConfig, emailTemplate, event, performed, trigger, workflow } from '../src/index';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { TABLES, renderPostgresDdl } from '../src/store/tables';

/**
 * journeyLambda end to end on the official local durable runner: an HTTP request (a Function
 * URL event) enters a user and submits the run as its own execution; the run sends, parks on a
 * callback, is woken by the next request's wake-up, and finalizes — with every step replayed
 * by the real SDK, against a real Postgres (PGlite).
 */

let pg: PGlite;

function client(db: {
  query: PGlite['query'];
  transaction?: PGlite['transaction'];
}): SqlClientLike {
  return {
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await db.query<T>(text, [...params])).rows,
    transaction: (fn) =>
      db.transaction === undefined
        ? fn(client(db))
        : db.transaction((tx) => fn(client({ query: tx.query.bind(tx) }))),
  };
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(renderPostgresDdl());
  await LocalDurableTestRunner.setupTestEnvironment();
}, 30_000);

afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    `TRUNCATE ${Object.values(TABLES)
      .map((t) => `workflow."${t.name}"`)
      .join(', ')}`
  );
});

const e = event<{ login: Record<string, never>; purchase: { value: number } }>();
const emails = {
  welcome: emailTemplate({
    id: 'welcome',
    from: { email: 'hi@acme.test', name: 'Acme' },
    title: 'Welcome',
    props: z.strictObject({}),
    subject: 'Welcome aboard',
    preview: {},
    component: () => createElement('p', null, 'Hi'),
  }),
  thanks: emailTemplate({
    id: 'thanks',
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
    store: () => ({ store: new PostgresJourneyStore(client(pg)), close: async () => {} }),
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
    expect(start.name).toBe(executionName(body.started[0]));
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

    const runner = new LocalDurableTestRunner({ handlerFunction: journeys.handler });
    const running = runner.run({ payload: run });

    // Parked: the callback is armed in Postgres, and the welcome email went out once
    const callback = runner.getOperation('1:subscribe:0:callback');
    await callback.waitForData(WaitingOperationStatus.STARTED);
    // The last step before the wait parks: past it, the check has already run
    await runner.getOperation('1:remaining:0').waitForData(WaitingOperationStatus.COMPLETED);
    const armed = await new PostgresJourneyStore(client(pg)).executions.get(run.instanceId);
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
    const left = await new PostgresJourneyStore(client(pg)).executions.get(run.instanceId);
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

    const runner = new LocalDurableTestRunner({ handlerFunction: journeys.handler });
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
    const store = new PostgresJourneyStore(client(pg));
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

  test('execution names stay valid and stable for long instance ids', () => {
    const long = `${'w'.repeat(32)}-abcdef12-${'u'.repeat(24)}-xyz-lmn123`;
    const name = executionName(long);
    expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(executionName(long)).toBe(name);
    expect(executionName(`${long}x`)).not.toBe(name);
    expect(executionName('short-id')).toBe('short-id');
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
    const store = new PostgresJourneyStore(client(pg));
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

  test('erasing a user stops the execution first, then forgets its registry row', async () => {
    const control = fakeLambda();
    const stopped: string[] = [];
    const lambda: LambdaApi = {
      ...control.lambda,
      async stopExecution(arn) {
        stopped.push(arn);
        return true;
      },
    };
    const { store, env } = await routed(lambda);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    const result = await forgetUser(env, 'u1', store);
    expect(result).toMatchObject({ erased: true, pending: [] });
    expect(stopped).toEqual([expect.stringContaining(executionName(started[0]))]);
    expect(await store.executions.get(started[0])).toBeUndefined();
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
    await (await port.get(id)).terminate?.();
    const record = await store.executions.get(id);
    expect(record?.unresolvedAt).toBeTypeOf('number');
    expect(record?.arn).toBe(`arn:found:${executionName(id)}`);
    expect(stopped).toEqual([`arn:found:${executionName(id)}`]);
    expect(await store.executions.pendingStarts({ limit: 10 })).toEqual([]);
  });

  test("status speaks the router's vocabulary", async () => {
    let state: Awaited<ReturnType<LambdaApi['executionState']>> = 'running';
    const lambda: LambdaApi = { ...fakeLambda().lambda, executionState: async () => state };
    const { store, port, env } = await routed(lambda);
    const { started } = await ingestEvent(env, { userId: 'u1', event: 'login' }, store);
    const instance = await port.get(started[0]);
    const statuses: string[] = [];
    for (const next of [
      'running',
      'succeeded',
      'failed',
      'stopped',
      'timed_out',
      undefined,
    ] as const) {
      state = next;
      statuses.push((await instance.status?.())?.status ?? '?');
    }
    expect(statuses).toEqual([
      'running',
      'complete',
      'errored',
      'terminated',
      'terminated',
      'terminated',
    ]);
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
      config: journeyConfig('1 day'),
      env: { API_TOKEN: 'secret' },
      store: () => new PostgresJourneyStore(client(pg)),
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

  test('a store without an execution registry is refused with the reason', async () => {
    const journeys = journeyLambda({
      config: journeyConfig('1 day'),
      env: {},
      store: () => {
        const store = new PostgresJourneyStore(client(pg));
        return new Proxy(store, {
          get: (target, property) =>
            property === 'executions' ? undefined : Reflect.get(target, property, target),
        });
      },
      lambda: fakeLambda().lambda,
    });
    const { result } = await call(journeys.handler, request('/health', undefined, 'GET'));
    // The HTTP step answers 500 and logs why
    expect(result.getResult()).toMatchObject({ statusCode: 500 });
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
      config: defineConfig({
        workflows: [
          workflow({ id: 'welcome', trigger: trigger.event(e.login) }).email(emails.thanks, {}),
        ],
        templates: { email: emails },
      }),
      env: { API_TOKEN: 'secret' },
      store: () => new PostgresJourneyStore(client(pg)),
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
      store: () => new PostgresJourneyStore(client(pg)),
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
    const store = new PostgresJourneyStore(client(pg));
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
