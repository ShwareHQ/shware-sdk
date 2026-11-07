import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  JourneyClient,
  JourneyQueue,
  type JourneyQueueBinding,
  JourneyValidationError,
} from '../src/client';
import { journeyWorker } from '../src/cloudflare/worker';
import { defineContract } from '../src/contract';
import type { QueueMessageLike } from '../src/host/batch';
import { registerDevice } from '../src/host/ingest';
import { defineConfig, event, trigger, workflow } from '../src/index';
import { FakeJourney } from './fake-cloudflare';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

let database: PgliteDatabase;
beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await truncateAll(database.pg);
  vi.restoreAllMocks();
});

const contract = defineContract({
  events: { login: z.looseObject({ method: z.string() }) },
  profile: z.strictObject({ email: z.optional(z.email()), name: z.string() }),
});

const e = event<{ login: { method: string } }>();
const flow = workflow({ id: 'welcome', trigger: trigger.event(e.login) }).sendEvent(e.login, {
  method: 'again',
});
const config = defineConfig({ contract, workflows: [flow], templates: {} } as never);

async function setup() {
  const journey = new FakeJourney();
  const env = { JOURNEY: journey, ENVIRONMENT: 'development' };
  const worker = journeyWorker<typeof env>({
    email: () => ({ send: async () => ({}) }),
    store: () => ({ store: database.store, close: async () => {} }),
    config,
  });
  const call = (body: unknown) =>
    worker.fetch(
      new Request('http://worker/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env
    );
  await worker.fetch(new Request('http://worker/bundle/deploy', { method: 'POST' }), env);
  return { worker, env, journey, call };
}

function message(body: unknown, attempts = 1) {
  return {
    id: 'm1',
    body,
    attempts,
    ack: vi.fn<QueueMessageLike['ack']>(),
    retry: vi.fn<QueueMessageLike['retry']>(),
  };
}

const login = { event: 'login', payload: { method: 'email' }, id: 'evt-1', ts: 1_000 };

describe('POST /ingest', () => {
  test('the profile is in place when the event starts the journey', async () => {
    const { call, journey } = await setup();
    const merge = vi.spyOn(database.store, 'mergeProfile');
    const insert = vi.spyOn(database.store, 'insertEvent');

    const response = await call({
      userId: 'u1',
      profile: { name: 'Ada', email: 'ada@example.com' },
      events: [login],
    });

    expect(response.status).toBe(200);
    expect(merge.mock.invocationCallOrder[0]).toBeLessThan(
      insert.mock.invocationCallOrder[0] ?? Number.NaN
    );
    expect(await database.store.getProfile('u1')).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(journey.created).toHaveLength(1);
  });

  test('one refused event refuses the whole batch, profile included', async () => {
    const { call, journey } = await setup();

    const response = await call({
      userId: 'u1',
      profile: { name: 'Ada' },
      events: [login, { event: 'login', payload: { method: 1 } }],
    });

    expect(response.status).toBe(400);
    expect(await database.store.getProfile('u1')).toBeUndefined();
    expect(journey.created).toHaveLength(0);
  });

  test.each([
    ['nothing to report', { userId: 'u1' }],
    ['no user', { events: [login] }],
    ['a nested profile value', { userId: 'u1', profile: { name: { first: 'A' } } }],
    ['a reserved event', { userId: 'u1', events: [{ event: '$x' }] }],
  ])('refuses %s', async (_, body) => {
    const { call } = await setup();
    expect((await call(body)).status).toBe(400);
  });
});

describe('the profile keeps the latest write of each property', () => {
  test('a redelivered older patch does not put an old address back', async () => {
    await database.store.mergeProfile('u1', { email: 'new@example.com', name: 'Ada' }, 2_000);
    const merged = await database.store.mergeProfile(
      'u1',
      { email: 'old@example.com', plan: 'pro' },
      1_000
    );
    expect(merged).toEqual({ email: 'new@example.com', name: 'Ada', plan: 'pro' });
  });

  test('a cleared property stays cleared against an older patch', async () => {
    await database.store.mergeProfile('u1', { email: 'a@example.com' }, 1_000);
    await database.store.mergeProfile('u1', { email: null }, 3_000);
    expect(await database.store.mergeProfile('u1', { email: 'a@example.com' }, 2_000)).toEqual({});
  });
});

describe('journeyWorker queue', () => {
  test('applies a batch and acknowledges it', async () => {
    const { worker, env, journey } = await setup();
    const delivered = message({ userId: 'u1', profile: { name: 'Ada' }, at: 1, events: [login] });

    await worker.queue({ messages: [delivered] }, env);

    expect(delivered.ack).toHaveBeenCalledTimes(1);
    expect(delivered.retry).not.toHaveBeenCalled();
    expect(await database.store.getProfile('u1')).toEqual({ name: 'Ada' });
    expect(journey.created).toHaveLength(1);
  });

  test('a redelivered batch records its event and starts its journey once', async () => {
    const { worker, env, journey } = await setup();
    const body = { userId: 'u1', events: [login] };

    await worker.queue({ messages: [message(body)] }, env);
    await worker.queue({ messages: [message(body, 2)] }, env);

    expect(journey.created).toHaveLength(1);
  });

  test('a failure retries with a backoff, one message at a time', async () => {
    const { worker, env } = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(database.store, 'insertEvent').mockRejectedValueOnce(new Error('db down'));
    const failed = message({ userId: 'u1', events: [login] }, 3);
    const next = message({ userId: 'u2', profile: { name: 'Bo' } });

    await worker.queue({ messages: [failed, next] }, env);

    expect(failed.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(failed.ack).not.toHaveBeenCalled();
    expect(next.ack).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('batch m1 failed');
  });

  test('the backoff stops growing at 15 minutes', async () => {
    const { worker, env } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(database.store, 'insertEvent').mockRejectedValueOnce(new Error('db down'));
    const failed = message({ userId: 'u1', events: [login] }, 12);

    await worker.queue({ messages: [failed] }, env);

    expect(failed.retry).toHaveBeenCalledWith({ delaySeconds: 900 });
  });

  test('a batch the contract refuses is acknowledged, logged without its payload', async () => {
    const { worker, env } = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = message({
      userId: 'u1',
      events: [{ event: 'login', payload: { method: 'secret', extra: 1 }, id: 'e' }],
      profile: { name: 'Ada', unknown: 'secret-value' },
    });

    await worker.queue({ messages: [refused] }, env);

    expect(refused.ack).toHaveBeenCalledTimes(1);
    expect(refused.retry).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).not.toContain('secret-value');
  });

  test('a batch for an erased user is acknowledged, not retried', async () => {
    const { worker, env } = await setup();
    await database.store.mergeProfile('u1', { name: 'Ada' });
    await worker.fetch(
      new Request('http://worker/users/forget', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u1' }),
      }),
      env
    );
    const late = message({ userId: 'u1', profile: { name: 'Ada' }, events: [login] });

    await worker.queue({ messages: [late] }, env);

    expect(late.ack).toHaveBeenCalledTimes(1);
    expect(late.retry).not.toHaveBeenCalled();
  });
});

describe('a late delivery', () => {
  test('carries when the trigger happened, not when it arrived', async () => {
    const { call, journey } = await setup();
    await call({ userId: 'u1', events: [login] });
    expect(journey.created[0]?.params).toMatchObject({ trigger: { event: 'login', ts: 1_000 } });
  });
});

describe('producers', () => {
  const profile = { name: 'Ada', email: 'ada@example.com' };

  test('JourneyQueue sends one message with its ids and times fixed', async () => {
    const send = vi.fn<JourneyQueueBinding['send']>(async () => undefined);
    const queue = new JourneyQueue({ contract, queue: { send } });

    await queue.ingest({
      userId: 'u1',
      profile,
      events: [{ event: 'login', payload: { method: 'x' } }],
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      userId: 'u1',
      profile,
      at: expect.any(Number),
      events: [
        {
          event: 'login',
          payload: { method: 'x' },
          id: expect.any(String),
          ts: expect.any(Number),
        },
      ],
    });
  });

  test('a batch the contract refuses is never sent', async () => {
    const send = vi.fn<JourneyQueueBinding['send']>(async () => undefined);
    const queue = new JourneyQueue({ contract, queue: { send } });

    await expect(
      queue.ingest({
        userId: 'u1',
        events: [{ event: 'login', payload: { method: 1 as never } }],
      })
    ).rejects.toBeInstanceOf(JourneyValidationError);
    await expect(
      queue.ingest({ userId: 'u1', profile: { name: 'Ada', email: 'nope' } })
    ).rejects.toBeInstanceOf(JourneyValidationError);
    expect(send).not.toHaveBeenCalled();
  });

  test('a failed send rejects, so the caller knows it was not queued', async () => {
    const queue = new JourneyQueue({
      contract,
      queue: {
        send: async () => {
          throw new Error('queue down');
        },
      },
    });
    await expect(queue.ingest({ userId: 'u1', profile })).rejects.toThrow('queue down');
  });

  test('JourneyClient.ingest posts the batch', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const client = new JourneyClient({
      contract,
      origin: 'https://wf.example',
      fetch: async (url, init) => {
        calls.push({ url: url as string, body: JSON.parse(init?.body as string) });
        return Response.json({ events: [] });
      },
    });

    await client.ingest({
      userId: 'u1',
      profile,
      events: [{ event: 'login', payload: { method: 'x' }, id: 'evt', ts: 5 }],
    });

    expect(calls).toEqual([
      {
        url: 'https://wf.example/ingest',
        body: {
          userId: 'u1',
          profile,
          at: expect.any(Number),
          events: [{ event: 'login', payload: { method: 'x' }, id: 'evt', ts: 5 }],
        },
      },
    ]);
  });
});

describe('a visitor before and after sign-in', () => {
  const e2 = event<{ login: { method: string }; browse: { page: string } }>();
  const visitorContract = defineContract({
    events: {
      login: z.looseObject({ method: z.string() }),
      browse: z.looseObject({ page: z.string() }),
    },
    profile: z.strictObject({ email: z.optional(z.email()), name: z.string() }),
  });
  const open = workflow({ id: 'open', trigger: trigger.event(e2.browse) }).delay('1 hour');
  const forVisitors = workflow({
    id: 'for_visitors',
    trigger: trigger.event(e2.browse, { visitors: true }),
  }).delay('1 hour');

  async function visitorSetup() {
    const journey = new FakeJourney();
    const env = { JOURNEY: journey, ENVIRONMENT: 'development' };
    const worker = journeyWorker<typeof env>({
      email: () => ({ send: async () => ({}) }),
      store: () => ({ store: database.store, close: async () => {} }),
      config: defineConfig({
        contract: visitorContract,
        workflows: [open, forVisitors],
        templates: {},
      } as never),
    });
    const post = async (path: string, body: unknown) =>
      worker.fetch(
        new Request(`http://worker${path}`, { method: 'POST', body: JSON.stringify(body) }),
        env
      );
    await worker.fetch(new Request('http://worker/bundle/deploy', { method: 'POST' }), env);
    return { journey, post };
  }
  const browse = (id: string) => ({ event: 'browse', payload: { page: '/' }, id, ts: 1_000 });
  const count = async (store: typeof database.store, subject: string) =>
    store.countEvents(subject, 'browse', {});

  test('a visitor enters only a workflow that asked for visitors', async () => {
    const { journey, post } = await visitorSetup();

    expect((await post('/ingest', { visitorId: 'v1', events: [browse('a')] })).status).toBe(200);

    expect(journey.created).toHaveLength(1);
    expect(journey.created[0]?.id).toMatch(/^for_visitors-/);
    expect(await database.store.getEntry('open', 'visitor:v1')).toBeUndefined();
  });

  test('no id at all is refused, and a user id cannot pose as a visitor', async () => {
    const { post } = await visitorSetup();
    expect((await post('/ingest', { events: [browse('a')] })).status).toBe(400);
    expect((await post('/ingest', { userId: 'visitor:v1', events: [] })).status).toBe(400);
  });

  test('naming both ids moves what the visitor had to the user, once', async () => {
    const { post } = await visitorSetup();
    await post('/devices', { visitorId: 'v1', deviceId: 'd1', token: 't1', platform: 'ios' });
    await post('/ingest', { visitorId: 'v1', profile: { name: 'Guest' }, at: 1_000 });
    await post('/ingest', { visitorId: 'v1', events: [browse('a')] });

    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'Ada' }, at: 2_000 });

    const { store } = database;
    expect(await count(store, 'u1')).toBe(1);
    expect(await count(store, 'visitor:v1')).toBe(0);
    expect(await store.getProfile('u1')).toEqual({ name: 'Ada' });
    expect(await store.getProfile('visitor:v1')).toBeUndefined();
    expect(await store.listDevices('u1')).toEqual([{ token: 't1', platform: 'ios' }]);
    expect(await store.listDevices('visitor:v1')).toEqual([]);
    expect(
      await store.entryOwner((await store.getEntry('for_visitors', 'u1'))?.instanceId ?? '')
    ).toBe('u1');
  });

  test('what moved wakes the waits on it, and the visitor of a dropped journey no longer wakes it', async () => {
    const { journey, post } = await visitorSetup();
    const { store } = database;
    await store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'own', hash: 'h', ts: 1 });
    await store.enterJourney({
      workflow: 'w',
      userId: 'visitor:v1',
      instanceId: 'dup',
      hash: 'h',
      ts: 1,
    });
    await store.subscribe('dup', 'visitor:v1', ['browse'], 1);
    await store.subscribe('waiting', 'u1', ['browse'], 1);
    journey.known.add('waiting');
    await post('/ingest', { visitorId: 'v1', events: [browse('a')] });

    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'Ada' } });

    expect(journey.wakes).toContainEqual(expect.objectContaining({ id: 'waiting' }));
    expect(await store.findWakeHandles('u1', 'browse')).not.toContain('dup');
  });

  test("the user's later clear of a property is not undone by the visitor's older value", async () => {
    const { store } = database;
    await store.mergeProfile('visitor:v1', { plan: 'old', city: 'Oslo' }, 1_000);
    await store.mergeProfile('u1', { plan: null }, 5_000);

    await store.linkVisitor('v1', 'u1', 6_000);

    expect(await store.getProfile('u1')).toEqual({ city: 'Oslo' });
  });

  test('a visitor who never signs in is pruned once idle, leaving no tombstone', async () => {
    const { post } = await visitorSetup();
    const { store } = database;
    // An event no workflow for visitors is routed to: no journey of theirs is running
    await store.touchVisitor('idle', Date.now());
    await store.insertEvent({
      id: 'i',
      userId: 'visitor:idle',
      event: 'browse',
      ts: 1,
      payload: {},
    });
    await post('/devices', { visitorId: 'idle', token: 'ti', platform: 'ios' });
    await post('/ingest', { visitorId: 'linked', events: [browse('l')] });
    await post('/ingest', { userId: 'u1', visitorId: 'linked', profile: { name: 'A' } });
    await store.enterJourney({
      workflow: 'x',
      userId: 'visitor:busy',
      instanceId: 'b',
      hash: 'h',
      ts: 1,
    });
    await store.touchVisitor('busy', 1);
    const future = Date.now() + 60_000;

    expect(await store.pruneVisitors(future, 10)).toBe(1);

    expect(await store.countEvents('visitor:idle', 'browse', {})).toBe(0);
    expect(await store.listDevices('visitor:idle')).toEqual([]);
    expect(await store.erasureState('visitor:idle')).toBe('none');
    expect(await store.linkedUser('linked')).toBe('u1');
    expect(await store.touchVisitor('busy', 1)).toBe('visitor:busy');
    expect((await post('/ingest', { visitorId: 'idle', events: [browse('again')] })).status).toBe(
      200
    );
  });

  test('a late report of a linked visitor reaches the user', async () => {
    const { post } = await visitorSetup();
    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'Ada' } });

    await post('/ingest', { visitorId: 'v1', events: [browse('late')] });

    expect(await count(database.store, 'u1')).toBe(1);
    expect(await count(database.store, 'visitor:v1')).toBe(0);
  });

  test('a visitor linked once stays with its first user', async () => {
    const { post } = await visitorSetup();
    await post('/ingest', { visitorId: 'v1', events: [browse('a')] });
    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'A' } });

    await post('/ingest', { userId: 'u2', visitorId: 'v1', profile: { name: 'B' } });

    expect(await database.store.linkedUser('v1')).toBe('u1');
    expect(await count(database.store, 'u1')).toBe(1);
    expect(await count(database.store, 'u2')).toBe(0);
  });

  test("an opt-out made as a visitor survives, and the user's own journey wins over the visitor's", async () => {
    const { journey, post } = await visitorSetup();
    await post('/ingest', { userId: 'u1', events: [browse('own')] });
    await post('/ingest', { visitorId: 'v1', events: [browse('a')] });
    await database.store.updateSuppressions(
      'visitor:v1',
      'push',
      [{ topic: null, suppressed: true }],
      1
    );
    const before = journey.created.length;
    const visitorInstance = (await database.store.getEntry('for_visitors', 'visitor:v1'))
      ?.instanceId;

    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'Ada' } });

    expect(journey.created).toHaveLength(before);
    expect(await database.store.entryOwner(visitorInstance ?? '')).toBeUndefined();
    expect(await database.store.isSuppressed('u1', 'push')).toBe(true);
  });

  test('the user is erased, and a later report of their visitor is refused', async () => {
    const { post } = await visitorSetup();
    await post('/ingest', { userId: 'u1', visitorId: 'v1', profile: { name: 'Ada' } });
    await post('/users/forget', { userId: 'u1' });

    expect((await post('/ingest', { visitorId: 'v1', events: [browse('late')] })).status).toBe(410);
    expect(await database.store.linkedUser('v1')).toBe('u1');
  });

  test('visitors stay out of the segment sweep', async () => {
    const { post } = await visitorSetup();
    await post('/ingest', { visitorId: 'v1', events: [browse('a')] });
    await post('/ingest', { userId: 'u1', events: [browse('b')] });

    expect(await database.store.listUserIds()).toEqual(['u1']);
  });
});

describe('one row per device, holding its current owner', () => {
  const register = (store: typeof database.store, device: object) => {
    const env = { JOURNEY: new FakeJourney(), ENVIRONMENT: 'development' };
    return registerDevice(env, device as never, store);
  };

  test('a new token of a device replaces the old one', async () => {
    const { store } = database;
    await register(store, { userId: 'u1', deviceId: 'd1', token: 'old', platform: 'ios' });
    await register(store, { userId: 'u1', deviceId: 'd1', token: 'new', platform: 'ios' });
    expect(await store.listDevices('u1')).toEqual([{ token: 'new', platform: 'ios' }]);
  });

  test("naming another owner's device id does not touch their token", async () => {
    const { store } = database;
    await register(store, { userId: 'a', deviceId: 'd1', token: 'theirs', platform: 'ios' });

    await register(store, { visitorId: 'x', deviceId: 'd1', token: 'mine', platform: 'ios' });

    expect(await store.listDevices('a')).toEqual([{ token: 'theirs', platform: 'ios' }]);
    expect(await store.listDevices('visitor:x')).toEqual([{ token: 'mine', platform: 'ios' }]);
  });

  test('a token nobody holds gives way to the same device under a new token', async () => {
    const { store } = database;
    await register(store, { userId: 'a', deviceId: 'd1', token: 'old', platform: 'ios' });
    await store.unbindDevice('old');

    await register(store, { visitorId: 'v', deviceId: 'd1', token: 'new', platform: 'ios' });

    const rows = await database.pg.query<{ token: string }>('SELECT token FROM workflow.device');
    expect(rows.rows).toEqual([{ token: 'new' }]);
  });

  test('A signed out, then B on the same device: A no longer reaches it', async () => {
    const { store } = database;
    await register(store, {
      userId: 'a',
      visitorId: 'v1',
      deviceId: 'd1',
      token: 't',
      platform: 'ios',
    });
    await store.unbindDevice('t');
    expect(await store.listDevices('a')).toEqual([]);

    await register(store, { visitorId: 'v2', deviceId: 'd1', token: 't', platform: 'ios' });
    expect(await store.listDevices('visitor:v2')).toEqual([{ token: 't', platform: 'ios' }]);

    await register(store, {
      userId: 'b',
      visitorId: 'v2',
      deviceId: 'd1',
      token: 't',
      platform: 'ios',
    });
    expect(await store.listDevices('b')).toEqual([{ token: 't', platform: 'ios' }]);
    expect(await store.listDevices('a')).toEqual([]);
    expect(await store.listDevices('visitor:v2')).toEqual([]);
  });

  test('registering keeps when the device first appeared', async () => {
    const { store } = database;
    await register(store, { userId: 'u1', token: 't', platform: 'ios' });
    const [first] = await database.pg
      .query<{ created_at: string; updated_at: string }>(
        'SELECT created_at, updated_at FROM workflow.device'
      )
      .then((r) => r.rows);
    await register(store, { userId: 'u2', token: 't', platform: 'android' });
    const [next] = await database.pg
      .query<{ created_at: string; updated_at: string }>(
        'SELECT created_at, updated_at FROM workflow.device'
      )
      .then((r) => r.rows);
    expect(next.created_at).toEqual(first.created_at);
    expect(new Date(next.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updated_at).getTime()
    );
  });
});
