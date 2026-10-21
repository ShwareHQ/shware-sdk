import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { d1Store } from '../src/cloudflare/d1-env';
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

/**
 * The HTTP surface over in-memory bindings: the bare ingest API (`handleRequest` — identify,
 * auth, validation, error mapping) and the journey host's routes around it (the production
 * gate, the error boundary, previews, tracking). The domain itself is ingest.test.ts.
 */

describe('identify', () => {
  const identifyRequest = (userId: string, props: Record<string, unknown>) =>
    new Request('https://worker.test/identify', {
      method: 'POST',
      body: JSON.stringify({ userId, props }),
    });

  test('merges the profile and wakes property-condition waits', async () => {
    const { env, db, journey } = makeEnv();
    journey.known.add('inst-wait');
    db.subscriptions.push({
      user_id: 'u1',
      event: profileUpdatedEvent('plan'),
      wake_handle: 'inst-wait',
      ts: 0,
    });

    const response = await handleRequest(identifyRequest('u1', { plan: 'pro' }), env);
    const body = (await response.json()) as { woke: number };

    expect(response.status).toBe(200);
    expect(body.woke).toBe(1);
    expect(journey.wakes).toEqual([{ id: 'inst-wait', type: WAKE_EVENT_TYPE }]);
    expect(db.profiles.get('u1')).toBe(JSON.stringify({ plan: 'pro' }));
  });

  test('a lookup that fails for another reason keeps the subscription', async () => {
    const { env, db, journey } = makeEnv();
    db.subscriptions.push({
      user_id: 'u1',
      event: profileUpdatedEvent('plan'),
      wake_handle: 'inst-1',
      ts: 0,
    });
    journey.get = async () => {
      throw new Error('connection reset by peer');
    };
    const response = await handleRequest(identifyRequest('u1', { plan: 'pro' }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ woke: 0 });
    // A database blip must not silence the wait for good
    expect(db.subscriptions).toHaveLength(1);
  });

  test('a dangling subscription (unknown instance) is pruned, not fatal', async () => {
    // The fake fails `get` the way Cloudflare does; the adapter in makeEnv's env turns that into
    // the port's InstanceNotFoundError, the one failure the host drops a subscription on
    const { env, db } = makeEnv();
    db.subscriptions.push({
      user_id: 'u1',
      event: profileUpdatedEvent('plan'),
      wake_handle: 'gone',
      ts: 0,
    });

    const response = await handleRequest(identifyRequest('u1', { plan: 'pro' }), env);

    expect(response.status).toBe(200);
    expect(db.subscriptions).toEqual([]);
  });

  test('a transient send failure keeps the subscription for the next attempt', async () => {
    const { env, db, journey } = makeEnv();
    journey.known.add('inst-flaky');
    journey.failingSends.add('inst-flaky');
    db.subscriptions.push({
      user_id: 'u1',
      event: profileUpdatedEvent('plan'),
      wake_handle: 'inst-flaky',
      ts: 0,
    });

    const response = await handleRequest(identifyRequest('u1', { plan: 'pro' }), env);
    const body = (await response.json()) as { woke: number };

    expect(response.status).toBe(200);
    expect(body.woke).toBe(0);
    expect(db.subscriptions).toHaveLength(1);
  });

  /*
   * The merge happens inside the statement. Read-modify-write is what this used
   * to be, and two identifies landing together each read the same row, so
   * whichever wrote second replaced the other's fields wholesale.
   */
  test('a field written by a concurrent identify survives', async () => {
    const { env, db } = makeEnv();

    await Promise.all([
      handleRequest(identifyRequest('u1', { plan: 'pro' }), env),
      handleRequest(identifyRequest('u1', { country: 'JP' }), env),
    ]);

    expect(JSON.parse(db.profiles.get('u1') ?? '{}')).toEqual({ plan: 'pro', country: 'JP' });
  });

  test('later identifies add to the profile rather than replacing it', async () => {
    const { env, db } = makeEnv();
    await handleRequest(identifyRequest('u1', { plan: 'pro', seats: 3 }), env);
    await handleRequest(identifyRequest('u1', { seats: 5 }), env);

    expect(JSON.parse(db.profiles.get('u1') ?? '{}')).toEqual({ plan: 'pro', seats: 5 });
  });

  test('null removes a property, which is the only way this API can unset one', async () => {
    const { env, db } = makeEnv();
    await handleRequest(identifyRequest('u1', { plan: 'pro', trial_ends: 1 }), env);

    const response = await handleRequest(identifyRequest('u1', { trial_ends: null }), env);
    const body = (await response.json()) as { props: Record<string, unknown> };

    expect(body.props).toEqual({ plan: 'pro' });
    expect(JSON.parse(db.profiles.get('u1') ?? '{}')).toEqual({ plan: 'pro' });
  });

  test('a non-object props is refused rather than replacing the profile wholesale', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      new Request('https://worker.test/identify', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u1', props: ['not', 'an', 'object'] }),
      }),
      env
    );
    expect(response.status).toBe(400);
  });

  test('a profile change can move the user into a trigger-routed segment', async () => {
    const { env, db } = makeEnv();
    const vip = segment({ id: 'vip', condition: eq(u.subscription_plan, 'business') });
    const vipWelcome = workflow({ id: 'vip_welcome', trigger: trigger.segment(vip) }).email(
      firstTimeRecovery
    );
    await deployBundle(env, compileBundle({ workflows: [vipWelcome], segments: [vip] }));

    const response = await handleRequest(
      identifyRequest('u3', { subscription_plan: 'business' }),
      env
    );
    const body = (await response.json()) as { started: string[] };

    expect(body.started).toHaveLength(1);
    expect(db.entries[0]).toMatchObject({ workflow: 'vip_welcome', user_id: 'u3' });
    expect(db.segmentMembers.has('vip\nu3')).toBe(true);
  });
});

describe('http surface', () => {
  test('bearer auth guards mutating endpoints; /health stays open', async () => {
    const { env } = makeEnv({ API_TOKEN: 'secret' });

    const health = await handleRequest(new Request('https://worker.test/health'), env);
    expect(health.status).toBe(200);

    const denied = await handleRequest(
      new Request('https://worker.test/events', { method: 'POST', body: '{}' }),
      env
    );
    expect(denied.status).toBe(401);

    const allowed = await handleRequest(
      new Request('https://worker.test/events', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ userId: 'u1', event: 'login' }),
      }),
      env
    );
    expect(allowed.status).toBe(200);
  });

  test('an invalid deploy payload is a 400, not a leaked 500', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      new Request('https://worker.test/deploy', { method: 'POST', body: '{}' }),
      env
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
      env
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
  const erasing = { ts: 1, erased_at: null };
  const erased = { ts: 1, erased_at: 2 };

  test('ingestEvent, identifyUser and registerDevice throw UserErasedError', async () => {
    const { env, db } = makeEnv();
    db.erasures.set('u1', erasing);
    await expect(ingestEvent(env, { userId: 'u1', event: 'login' })).rejects.toBeInstanceOf(
      UserErasedError
    );
    expect(db.events).toEqual([]);
  });

  test.each([
    ['being erased', erasing],
    ['erased', erased],
  ])('/events, /identify and /devices answer 410 for a user %s', async (_, tombstone) => {
    const { env, db } = makeEnv();
    db.erasures.set('u1', tombstone);
    const requests = [
      post('/events', { userId: 'u1', event: 'login' }),
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      post('/devices', { userId: 'u1', token: 't1', platform: 'ios' }),
    ];
    for (const request of requests) {
      const response = await handleRequest(request, env);
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'user is erased' });
    }
    expect(db.events).toEqual([]);
    expect(db.profiles.size).toBe(0);
    expect(db.devices.size).toBe(0);
    // Another user is not affected
    const other = await handleRequest(post('/events', { userId: 'u2', event: 'login' }), env);
    expect(other.status).toBe(200);
  });

  test('the store refuses the write itself once the tombstone is there, pre-check or not', async () => {
    // The entry point's check passed (no tombstone yet); the tombstone lands before the write
    const { env, db } = makeEnv();
    const store = d1Store(env);
    db.erasures.set('u1', erasing);
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
    expect(db.events).toEqual([]);
    expect(db.profiles.size).toBe(0);
    expect(db.devices.size).toBe(0);
    expect(db.segmentMembers.size).toBe(0);
    expect(db.entries).toEqual([]);
    expect(db.subscriptions).toEqual([]);
  });

  test('forgetUser leaves the tombstone erased, and a repeat is idempotent', async () => {
    const { env, db } = makeEnv();
    await ingestEvent(env, { userId: 'u1', event: 'login' });
    await ingestEvent(env, { userId: 'u2', event: 'login' });

    expect(await forgetUser(env, 'u1', undefined, 7)).toEqual({
      ok: true,
      erased: true,
      pending: [],
    });
    expect(db.events.map((e) => e.user_id)).toEqual(['u2']);
    expect(db.erasures.get('u1')).toEqual({ ts: 7, erased_at: 7 });
    expect(await d1Store(env).erasureState('u1')).toBe('erased');
    expect(await d1Store(env).pendingErasures()).toEqual([]);

    // Again, later: nothing to do, the first erase's time stays
    expect(await forgetUser(env, 'u1', undefined, 9)).toEqual({
      ok: true,
      erased: true,
      pending: [],
    });
    expect(db.erasures.get('u1')).toEqual({ ts: 7, erased_at: 7 });

    // The id stays gone: a late event is refused, u2 goes on
    const late = await handleRequest(post('/events', { userId: 'u1', event: 'login' }), env);
    expect(late.status).toBe(410);
    expect(db.events.map((e) => e.user_id)).toEqual(['u2']);
    const other = await handleRequest(post('/events', { userId: 'u2', event: 'login' }), env);
    expect(other.status).toBe(200);
  });
});

describe('request validation', () => {
  test('a body that is not JSON is a 400, not a 500', async () => {
    const { env } = makeEnv();
    for (const path of ['/events', '/identify', '/devices', '/deploy']) {
      const response = await handleRequest(post(path, '{not json'), env);
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
        env
      );
      expect(events.status).toBe(400);
      expect(await events.json()).toEqual({
        error: 'ts must be a non-negative integer no later than 5 minutes in the future',
      });
      const devices = await handleRequest(
        post('/devices', { userId: 'u1', token: 't', platform: 'ios', ts }),
        env
      );
      expect(devices.status).toBe(400);
    }
    // Clock skew within the tolerance, and the past, are fine
    for (const ts of [0, Date.now() - 86_400_000, Date.now() + 60_000]) {
      const response = await handleRequest(
        post('/events', { userId: 'u1', event: 'login', ts }),
        env
      );
      expect(response.status).toBe(200);
    }
  });

  test('/identify takes scalars and null only, contract or not', async () => {
    const { env, db } = makeEnv();
    for (const props of [{ address: { city: 'Paris' } }, { tags: ['a'] }]) {
      const response = await handleRequest(post('/identify', { userId: 'u1', props }), env);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'props values must be scalars (string, number, boolean) or null',
      });
    }
    expect(db.profiles.size).toBe(0);
    const ok = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro', seats: 3, vip: true, trial: null } }),
      env
    );
    expect(ok.status).toBe(200);
  });
});

describe('identify wakes the waits on the properties it patched', () => {
  const subscribe = (db: ReturnType<typeof makeEnv>['db'], handle: string, event: string) =>
    db.subscriptions.push({ user_id: 'u1', event, wake_handle: handle, ts: 0 });

  test('a wait on another property sleeps on', async () => {
    const { env, db, journey } = makeEnv();
    for (const handle of ['inst-plan', 'inst-email']) journey.known.add(handle);
    subscribe(db, 'inst-plan', profileUpdatedEvent('plan'));
    subscribe(db, 'inst-email', profileUpdatedEvent('email'));

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      env
    );

    expect(await response.json()).toMatchObject({ woke: 1 });
    expect(journey.wakes).toEqual([{ id: 'inst-plan', type: WAKE_EVENT_TYPE }]);
  });

  test('an instance subscribed to several patched properties is woken once', async () => {
    const { env, db, journey } = makeEnv();
    journey.known.add('inst-both');
    subscribe(db, 'inst-both', profileUpdatedEvent('plan'));
    subscribe(db, 'inst-both', profileUpdatedEvent('seats'));

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro', seats: 5 } }),
      env
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
      env
    );
    expect(allowed.status).toBe(200);
    const denied = await handleRequest(
      post('/events', { userId: 'u1', event: 'login' }, { authorization: 'Bearer nope' }),
      env
    );
    expect(denied.status).toBe(401);
  });
});

/* The journey host over the fake bindings: what it adds around the router. */

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

function host(overrides?: Record<string, unknown>, reporting?: JourneyReporting) {
  const made = makeEnv(overrides);
  const base = d1Store(made.env);
  const store: JourneyStore =
    reporting === undefined
      ? base
      : new Proxy(base, {
          get: (target, property, receiver) =>
            property === 'reporting' ? reporting : Reflect.get(target, property, receiver),
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
    // Recipients' routes stay up: no reporting here, so the router's 404, never the 503
    expect((await call('/t/o/0190a3b8-0000-7000-8000-000000000001')).status).toBe(404);
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
    const { env, store, call } = host({ ENVIRONMENT: 'development' });
    await deployBundle(env, compileBundle({ workflows: [], segments: [] }), store);
    store.listSegments = async () => {
      throw new Error('D1_ERROR: table segments has no column named secret');
    };
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
    const { db, journey, call } = host({ ENVIRONMENT: 'development' }, reports);
    journey.known.add('inst-exit');
    journey.known.add('inst-plan');
    db.subscriptions.push(
      { user_id: 'u1', event: profileUpdatedEvent('email'), wake_handle: 'inst-exit', ts: 0 },
      { user_id: 'u1', event: profileUpdatedEvent('plan'), wake_handle: 'inst-plan', ts: 0 },
      { user_id: 'u2', event: profileUpdatedEvent('email'), wake_handle: 'inst-other', ts: 0 }
    );

    const response = await call(`/t/u/${messageId}`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(reports.unsubscribed).toEqual([messageId]);
    expect(journey.wakes).toEqual([{ id: 'inst-exit', type: WAKE_EVENT_TYPE }]);
  });

  test('an unknown copy still answers the one-click POST, and wakes nobody', async () => {
    const reports = reporting();
    const { journey, call } = host({ ENVIRONMENT: 'development' }, reports);
    const response = await call('/t/u/0190a3b8-0000-7000-8000-000000000002', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(journey.wakes).toEqual([]);
  });
});
