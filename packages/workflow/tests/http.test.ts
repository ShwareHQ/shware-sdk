import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { profileUpdatedEvent } from '../src/engine/condition';
import { bearerMatches } from '../src/host/auth';
import { handleRequest } from '../src/host/http';
import { deployBundle, forgetUser, ingestEvent } from '../src/host/ingest';
import { createJourneyHost } from '../src/host/journey-host';
import { WAKE_EVENT_TYPE } from '../src/host/platform';
import {
  compileBundle,
  defineConfig,
  emailTemplate,
  eq,
  segment,
  trigger,
  workflow,
} from '../src/index';
import { type JourneyReporting, type JourneyStore, UserErasedError } from '../src/store/index';
import { makeEnv } from './fake-cloudflare';
import { e, firstTimeRecovery, u } from './fixtures';
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';

/**
 * The HTTP surface over the fake Workflow binding and a Postgres store (PGlite): the bare ingest
 * API (`handleRequest` — identify, auth, validation, error mapping) and the journey host's
 * routes around it (the production gate, the error boundary, previews, tracking). The domain
 * itself is ingest.test.ts.
 */

let database: PgliteDatabase;
beforeAll(async () => {
  database = await pgliteDatabase();
}, 30_000);
afterAll(async () => {
  await database.close();
});
// Every test starts from an empty engine: the tables are emptied, the database kept
beforeEach(async () => {
  await truncateAll(database.pg);
});

/** How many rows the table holds. */
const rows = async (table: string) =>
  (
    await database.client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM workflow.${table}`)
  )[0].c;
/** The users with an event, in the order the events arrived. */
const eventUsers = async () =>
  (
    await database.client.query<{ user_id: string }>(
      'SELECT user_id FROM workflow.event ORDER BY ts, id'
    )
  ).map((row) => row.user_id);
/** The user's erasure tombstone, its times as epoch ms; undefined without one. */
const erasure = async (userId: string) =>
  (
    await database.client.query<{ ts: number; erased_at: number | null }>(
      `SELECT (extract(epoch FROM requested_at) * 1000)::int AS ts,
              (extract(epoch FROM erased_at) * 1000)::int AS erased_at
         FROM workflow.erasure WHERE user_id = $1`,
      [userId]
    )
  )[0];
/** A wake subscription, as the runner registers one. */
const subscribe = (handle: string, userId: string, event: string) =>
  database.store.subscribe(handle, userId, [event], 0);

describe('identify', () => {
  const identifyRequest = (userId: string, props: Record<string, unknown>) =>
    new Request('https://worker.test/identify', {
      method: 'POST',
      body: JSON.stringify({ userId, props }),
    });

  test('merges the profile and wakes property-condition waits', async () => {
    const { env, journey } = makeEnv();
    journey.known.add('inst-wait');
    await subscribe('inst-wait', 'u1', profileUpdatedEvent('plan'));

    const response = await handleRequest(
      identifyRequest('u1', { plan: 'pro' }),
      env,
      database.store
    );
    const body = (await response.json()) as { woke: number };

    expect(response.status).toBe(200);
    expect(body.woke).toBe(1);
    expect(journey.wakes).toEqual([{ id: 'inst-wait', type: WAKE_EVENT_TYPE }]);
    expect(await database.store.getProfile('u1')).toEqual({ plan: 'pro' });
  });

  test('a lookup that fails for another reason keeps the subscription', async () => {
    const { env, journey } = makeEnv();
    await subscribe('inst-1', 'u1', profileUpdatedEvent('plan'));
    journey.get = async () => {
      throw new Error('connection reset by peer');
    };
    const response = await handleRequest(
      identifyRequest('u1', { plan: 'pro' }),
      env,
      database.store
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ woke: 0 });
    // A database blip must not silence the wait for good
    expect(await rows('subscription')).toBe(1);
  });

  test('a dangling subscription (unknown instance) is pruned, not fatal', async () => {
    // The fake fails `get` the way Cloudflare does; the adapter in makeEnv's env turns that into
    // the port's InstanceNotFoundError, the one failure the host drops a subscription on
    const { env } = makeEnv();
    await subscribe('gone', 'u1', profileUpdatedEvent('plan'));

    const response = await handleRequest(
      identifyRequest('u1', { plan: 'pro' }),
      env,
      database.store
    );

    expect(response.status).toBe(200);
    expect(await rows('subscription')).toBe(0);
  });

  test('a transient send failure keeps the subscription for the next attempt', async () => {
    const { env, journey } = makeEnv();
    journey.known.add('inst-flaky');
    journey.failingSends.add('inst-flaky');
    await subscribe('inst-flaky', 'u1', profileUpdatedEvent('plan'));

    const response = await handleRequest(
      identifyRequest('u1', { plan: 'pro' }),
      env,
      database.store
    );
    const body = (await response.json()) as { woke: number };

    expect(response.status).toBe(200);
    expect(body.woke).toBe(0);
    expect(await rows('subscription')).toBe(1);
  });

  /*
   * The merge happens inside the statement. Read-modify-write is what this used
   * to be, and two identifies landing together each read the same row, so
   * whichever wrote second replaced the other's fields wholesale.
   */
  test('a field written by a concurrent identify survives', async () => {
    const { env } = makeEnv();

    await Promise.all([
      handleRequest(identifyRequest('u1', { plan: 'pro' }), env, database.store),
      handleRequest(identifyRequest('u1', { country: 'JP' }), env, database.store),
    ]);

    expect(await database.store.getProfile('u1')).toEqual({ plan: 'pro', country: 'JP' });
  });

  test('later identifies add to the profile rather than replacing it', async () => {
    const { env } = makeEnv();
    await handleRequest(identifyRequest('u1', { plan: 'pro', seats: 3 }), env, database.store);
    await handleRequest(identifyRequest('u1', { seats: 5 }), env, database.store);

    expect(await database.store.getProfile('u1')).toEqual({ plan: 'pro', seats: 5 });
  });

  test('null removes a property, which is the only way this API can unset one', async () => {
    const { env } = makeEnv();
    await handleRequest(identifyRequest('u1', { plan: 'pro', trial_ends: 1 }), env, database.store);

    const response = await handleRequest(
      identifyRequest('u1', { trial_ends: null }),
      env,
      database.store
    );
    const body = (await response.json()) as { props: Record<string, unknown> };

    expect(body.props).toEqual({ plan: 'pro' });
    expect(await database.store.getProfile('u1')).toEqual({ plan: 'pro' });
  });

  test('a non-object props is refused rather than replacing the profile wholesale', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      new Request('https://worker.test/identify', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u1', props: ['not', 'an', 'object'] }),
      }),
      env,
      database.store
    );
    expect(response.status).toBe(400);
  });

  test('a profile change can move the user into a trigger-routed segment', async () => {
    const { env } = makeEnv();
    const vip = segment({ id: 'vip', condition: eq(u.subscription_plan, 'business') });
    const vipWelcome = workflow({ id: 'vip_welcome', trigger: trigger.segment(vip) }).email(
      firstTimeRecovery
    );
    await deployBundle(
      env,
      compileBundle({ workflows: [vipWelcome], segments: [vip] }),
      database.store
    );

    const response = await handleRequest(
      identifyRequest('u3', { subscription_plan: 'business' }),
      env,
      database.store
    );
    const body = (await response.json()) as { started: string[] };

    expect(body.started).toHaveLength(1);
    expect(await database.client.query('SELECT workflow, user_id FROM workflow.entry')).toEqual([
      { workflow: 'vip_welcome', user_id: 'u3' },
    ]);
    expect(await database.store.isSegmentMember('vip', 'u3')).toBe(true);
  });
});

describe('http surface', () => {
  test('bearer auth guards mutating endpoints; /health stays open', async () => {
    const { env } = makeEnv({ API_TOKEN: 'secret' });

    const health = await handleRequest(
      new Request('https://worker.test/health'),
      env,
      database.store
    );
    expect(health.status).toBe(200);

    const denied = await handleRequest(
      new Request('https://worker.test/events', { method: 'POST', body: '{}' }),
      env,
      database.store
    );
    expect(denied.status).toBe(401);

    const allowed = await handleRequest(
      new Request('https://worker.test/events', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ userId: 'u1', event: 'login' }),
      }),
      env,
      database.store
    );
    expect(allowed.status).toBe(200);
  });

  test('an invalid deploy payload is a 400, not a leaked 500', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      new Request('https://worker.test/deploy', { method: 'POST', body: '{}' }),
      env,
      database.store
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('invalid payload');
  });

  test('reserved event names are a 400 at the HTTP layer', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      new Request('https://worker.test/events', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u1', event: '$segment_entry' }),
      }),
      env,
      database.store
    );
    expect(response.status).toBe(400);
  });
});

/* ------------------------------ host behavior ------------------------------ */

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('a user with an erasure tombstone is refused everywhere that writes about them', () => {
  /*
   * forgetUser commits the tombstone, stops the instances, then erases. Between the stop and the
   * erase a write would come back after it: an event re-creates the user, an identify a profile.
   * After the erase the tombstone stays, so a late write cannot bring the user back either.
   */
  /** The tombstone as it stands while the instances are being stopped. */
  const erasing = (userId: string) => database.store.requestErasure(userId, 1);
  /** The tombstone once the data is gone. */
  const erased = async (userId: string) => {
    await database.store.requestErasure(userId, 1);
    await database.store.forgetUser(userId, 2);
  };

  test('ingestEvent, identifyUser and registerDevice throw UserErasedError', async () => {
    const { env } = makeEnv();
    await erasing('u1');
    await expect(
      ingestEvent(env, { userId: 'u1', event: 'login' }, database.store)
    ).rejects.toBeInstanceOf(UserErasedError);
    expect(await rows('event')).toBe(0);
  });

  test.each([
    ['being erased', erasing],
    ['erased', erased],
  ])('/events, /identify and /devices answer 410 for a user %s', async (_, tombstone) => {
    const { env } = makeEnv();
    await tombstone('u1');
    const requests = [
      post('/events', { userId: 'u1', event: 'login' }),
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      post('/devices', { userId: 'u1', token: 't1', platform: 'ios' }),
    ];
    for (const request of requests) {
      const response = await handleRequest(request, env, database.store);
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'user is erased' });
    }
    expect(await rows('event')).toBe(0);
    expect(await rows('profile')).toBe(0);
    expect(await rows('device')).toBe(0);
    // Another user is not affected
    const other = await handleRequest(
      post('/events', { userId: 'u2', event: 'login' }),
      env,
      database.store
    );
    expect(other.status).toBe(200);
  });

  test('the store refuses the write itself once the tombstone is there, pre-check or not', async () => {
    // The entry point's check passed (no tombstone yet); the tombstone lands before the write
    const store = database.store;
    await erasing('u1');
    await expect(
      store.insertEvent({ id: 'e1', userId: 'u1', event: 'login', ts: 1, payload: {} })
    ).rejects.toBeInstanceOf(UserErasedError);
    await expect(store.mergeProfile('u1', { plan: 'pro' })).rejects.toBeInstanceOf(UserErasedError);
    await expect(
      store.upsertDevice({ userId: 'u1', token: 't1', platform: 'ios', ts: 1 })
    ).rejects.toBeInstanceOf(UserErasedError);
    await expect(store.addSegmentMember('s', 'u1', 1, ['w'])).rejects.toBeInstanceOf(
      UserErasedError
    );
    await expect(
      store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i1', hash: 'h', ts: 1 })
    ).rejects.toBeInstanceOf(UserErasedError);
    await expect(store.subscribe('i1', 'u1', ['login'], 1)).rejects.toBeInstanceOf(UserErasedError);
    for (const table of ['event', 'profile', 'device', 'segment_member', 'entry', 'subscription']) {
      expect(await rows(table)).toBe(0);
    }
  });

  test('forgetUser leaves the tombstone erased, and a repeat is idempotent', async () => {
    const { env } = makeEnv();
    await ingestEvent(env, { userId: 'u1', event: 'login' }, database.store);
    await ingestEvent(env, { userId: 'u2', event: 'login' }, database.store);

    expect(await forgetUser(env, 'u1', database.store, 7)).toEqual({
      ok: true,
      erased: true,
      pending: [],
    });
    expect(await eventUsers()).toEqual(['u2']);
    expect(await erasure('u1')).toEqual({ ts: 7, erased_at: 7 });
    expect(await database.store.erasureState('u1')).toBe('erased');
    expect(await database.store.pendingErasures()).toEqual([]);

    // Again, later: nothing to do, the first erase's time stays
    expect(await forgetUser(env, 'u1', database.store, 9)).toEqual({
      ok: true,
      erased: true,
      pending: [],
    });
    expect(await erasure('u1')).toEqual({ ts: 7, erased_at: 7 });

    // The id stays gone: a late event is refused, u2 goes on
    const late = await handleRequest(
      post('/events', { userId: 'u1', event: 'login' }),
      env,
      database.store
    );
    expect(late.status).toBe(410);
    expect(await eventUsers()).toEqual(['u2']);
    const other = await handleRequest(
      post('/events', { userId: 'u2', event: 'login' }),
      env,
      database.store
    );
    expect(other.status).toBe(200);
  });
});

describe('request validation', () => {
  test('a body that is not JSON is a 400, not a 500', async () => {
    const { env } = makeEnv();
    for (const path of ['/events', '/identify', '/devices', '/deploy']) {
      const response = await handleRequest(post(path, '{not json'), env, database.store);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid JSON body' });
    }
  });

  test('ts must be a whole, non-negative epoch no later than 5 minutes ahead', async () => {
    const { env } = makeEnv();
    const refused = [-1, 1.5, Date.now() + 6 * 60_000, Number.MAX_SAFE_INTEGER + 2, '123'];
    for (const ts of refused) {
      const events = await handleRequest(
        post('/events', { userId: 'u1', event: 'login', ts }),
        env,
        database.store
      );
      expect(events.status).toBe(400);
      expect(await events.json()).toEqual({
        error: 'ts must be a non-negative integer no later than 5 minutes in the future',
      });
      const devices = await handleRequest(
        post('/devices', { userId: 'u1', token: 't', platform: 'ios', ts }),
        env,
        database.store
      );
      expect(devices.status).toBe(400);
    }
    // Clock skew within the tolerance, and the past, are fine
    for (const ts of [0, Date.now() - 86_400_000, Date.now() + 60_000]) {
      const response = await handleRequest(
        post('/events', { userId: 'u1', event: 'login', ts }),
        env,
        database.store
      );
      expect(response.status).toBe(200);
    }
  });

  test('/identify takes scalars and null only, contract or not', async () => {
    const { env } = makeEnv();
    for (const props of [{ address: { city: 'Paris' } }, { tags: ['a'] }]) {
      const response = await handleRequest(
        post('/identify', { userId: 'u1', props }),
        env,
        database.store
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'props values must be scalars (string, number, boolean) or null',
      });
    }
    expect(await rows('profile')).toBe(0);
    const ok = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro', seats: 3, vip: true, trial: null } }),
      env,
      database.store
    );
    expect(ok.status).toBe(200);
  });
});

describe('identify wakes the waits on the properties it patched', () => {
  test('a wait on another property sleeps on', async () => {
    const { env, journey } = makeEnv();
    for (const handle of ['inst-plan', 'inst-email']) journey.known.add(handle);
    await subscribe('inst-plan', 'u1', profileUpdatedEvent('plan'));
    await subscribe('inst-email', 'u1', profileUpdatedEvent('email'));

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      env,
      database.store
    );

    expect(await response.json()).toMatchObject({ woke: 1 });
    expect(journey.wakes).toEqual([{ id: 'inst-plan', type: WAKE_EVENT_TYPE }]);
  });

  test('an instance subscribed to several patched properties is woken once', async () => {
    const { env, journey } = makeEnv();
    journey.known.add('inst-both');
    await subscribe('inst-both', 'u1', profileUpdatedEvent('plan'));
    await subscribe('inst-both', 'u1', profileUpdatedEvent('seats'));

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro', seats: 5 } }),
      env,
      database.store
    );

    expect(await response.json()).toMatchObject({ woke: 1 });
    expect(journey.wakes).toEqual([{ id: 'inst-both', type: WAKE_EVENT_TYPE }]);
  });
});

describe('bearer authentication', () => {
  test('the scheme is case-insensitive, the token is not', () => {
    const request = (authorization: string) =>
      new Request('https://worker.test/events', { headers: { authorization } });
    expect(bearerMatches(request('Bearer secret'), 'secret')).toBe(true);
    expect(bearerMatches(request('bearer secret'), 'secret')).toBe(true);
    expect(bearerMatches(request('BEARER secret'), 'secret')).toBe(true);
    expect(bearerMatches(request('Bearer Secret'), 'secret')).toBe(false);
    expect(bearerMatches(request('Bearer secre'), 'secret')).toBe(false);
    expect(bearerMatches(request('Bearer secret2'), 'secret')).toBe(false);
    expect(bearerMatches(request('Basic secret'), 'secret')).toBe(false);
    expect(bearerMatches(request('secret'), 'secret')).toBe(false);
    expect(bearerMatches(new Request('https://worker.test/events'), 'secret')).toBe(false);
  });

  test('the router accepts a lower-case scheme', async () => {
    const { env } = makeEnv({ API_TOKEN: 'secret' });
    const allowed = await handleRequest(
      post('/events', { userId: 'u1', event: 'login' }, { authorization: 'bearer secret' }),
      env,
      database.store
    );
    expect(allowed.status).toBe(200);
    const denied = await handleRequest(
      post('/events', { userId: 'u1', event: 'login' }, { authorization: 'Bearer nope' }),
      env,
      database.store
    );
    expect(denied.status).toBe(401);
  });
});

/* The journey host over the fake binding: what it adds around the router. */

const hostEmails = {
  bienvenue: emailTemplate({
    id: 'bienvenue',
    from: 'hi@acme.test',
    title: 'Bienvenue',
    props: z.strictObject({}),
    subject: 'Bienvenue à bord 🎉',
    preview: {},
    component: () => createElement('p', null, 'Salut'),
  }),
};
const hostConfig = defineConfig({
  workflows: [
    workflow({ id: 'welcome', trigger: trigger.event(e.sign_up) }).email(hostEmails.bienvenue, {}),
  ],
  templates: { email: hostEmails },
});

/**
 * The host over the database's store; `patch` stands in for the members it names (the shared
 * store itself is left untouched).
 */
function host(overrides?: Record<string, unknown>, patch: Partial<JourneyStore> = {}) {
  const made = makeEnv(overrides);
  const store: JourneyStore = new Proxy(database.store, {
    get: (target, property, receiver) =>
      property in patch
        ? patch[property as keyof JourneyStore]
        : Reflect.get(target, property, receiver),
  });
  const journeyHost = createJourneyHost({
    config: hostConfig,
    email: () => ({ send: async () => ({}) }),
    store: () => store,
  });
  const call = (path: string, init?: RequestInit) =>
    journeyHost.handle(new Request(`https://worker.test${path}`, init), made.env, store);
  return { ...made, store, call };
}

describe('production refuses to serve without API_TOKEN', () => {
  test('everything but the health check and the tracking routes answers 503', async () => {
    const { call } = host(); // no ENVIRONMENT: production
    const refused = [
      ['/events', 'POST'],
      ['/identify', 'POST'],
      ['/bundle', 'GET'],
      ['/bundle/deploy', 'POST'],
      ['/segments/sweep', 'POST'],
      ['/preview/bienvenue', 'GET'],
      ['/deploy', 'POST'],
      ['/health', 'POST'],
    ] as const;
    for (const [path, method] of refused) {
      const response = await call(path, { method, body: method === 'POST' ? '{}' : null });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error:
          'API_TOKEN is not set: production refuses to serve without it (set ENVIRONMENT=development to run open)',
      });
    }
    expect((await call('/health')).status).toBe(200);
    // Recipients' routes stay up: the pixel answers for a copy nobody knows, never the 503
    const pixel = await call('/t/o/0190a3b8-0000-7000-8000-000000000001');
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
  });

  test('development runs open; production with a token serves', async () => {
    const open = host({ ENVIRONMENT: 'development' });
    expect((await open.call('/bundle')).status).toBe(200);
    const closed = host({ API_TOKEN: 'secret' });
    expect((await closed.call('/bundle')).status).toBe(401);
    expect(
      (await closed.call('/bundle', { headers: { authorization: 'bearer secret' } })).status
    ).toBe(200);
  });
});

describe('the host boundary', () => {
  test('an unexpected failure is a 500 with nothing of it in the body', async () => {
    const { env, store, call } = host(
      { ENVIRONMENT: 'development' },
      {
        listSegments: async () => {
          throw new Error('relation "workflow.segment" does not exist');
        },
      }
    );
    await deployBundle(env, compileBundle({ workflows: [], segments: [] }), store);
    const response = await call('/segments/sweep', { method: 'POST' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal error' });
  });

  test('a non-ASCII subject travels percent-encoded in x-subject', async () => {
    const { call } = host({ ENVIRONMENT: 'development' });
    const response = await call('/preview/bienvenue');
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get('x-subject') ?? '')).toBe('Bienvenue à bord 🎉');
  });
});

describe('an unsubscribe wakes the waits reading email reachability', () => {
  const messageId = '0190a3b8-0000-7000-8000-000000000001';
  /** Reporting that knows one email copy of u1, and records its unsubscribe. */
  function reporting(): JourneyReporting & { unsubscribed: string[] } {
    const unsubscribed: string[] = [];
    const unknown = async () => false;
    return {
      unsubscribed,
      instanceStarted: async () => {},
      nodeReached: async () => {},
      instanceFinished: async () => {},
      recordMessage: async () => messageId,
      messageSettled: async () => false,
      settleMessage: async () => {},
      recordLinks: async () => {},
      recordOpen: async (id, judge) => {
        if (id !== messageId) return false;
        judge({ userId: 'u1', deliveredAt: 0 });
        return true;
      },
      recordClick: async () => undefined,
      recordUnsubscribe: async (id) => {
        if (id !== messageId) return undefined;
        unsubscribed.push(id);
        return { userId: 'u1' };
      },
      recordDeviceDelivered: unknown,
      snapshotSegments: async () => [],
    };
  }

  test('POST /t/u records it and wakes the email-property channel of its recipient', async () => {
    const reports = reporting();
    const { journey, call } = host({ ENVIRONMENT: 'development' }, { reporting: reports });
    journey.known.add('inst-exit');
    journey.known.add('inst-plan');
    await subscribe('inst-exit', 'u1', profileUpdatedEvent('email'));
    await subscribe('inst-plan', 'u1', profileUpdatedEvent('plan'));
    await subscribe('inst-other', 'u2', profileUpdatedEvent('email'));

    const response = await call(`/t/u/${messageId}`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(reports.unsubscribed).toEqual([messageId]);
    expect(journey.wakes).toEqual([{ id: 'inst-exit', type: WAKE_EVENT_TYPE }]);
  });

  test('an unknown copy still answers the one-click POST, and wakes nobody', async () => {
    const reports = reporting();
    const { journey, call } = host({ ENVIRONMENT: 'development' }, { reporting: reports });
    const response = await call('/t/u/0190a3b8-0000-7000-8000-000000000002', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(journey.wakes).toEqual([]);
  });
});
