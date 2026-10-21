import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { WAKE_EVENT_TYPE } from '../src/cloudflare/bindings';
import { d1Store } from '../src/cloudflare/d1-env';
import { PROFILE_UPDATED_EVENT, profileUpdatedEvent } from '../src/engine/condition';
import { bearerMatches } from '../src/host/auth';
import { createJourneyHost } from '../src/host/journey-host';
import {
  UserErasedError,
  deployBundle,
  handleRequest,
  ingestEvent,
  sweepSegments,
  sweepSegmentsPaged,
} from '../src/host/router';
import {
  compileBundle,
  defineConfig,
  emailTemplate,
  eq,
  segment,
  trigger,
  workflow,
} from '../src/index';
import type { JourneyReporting, JourneyStore } from '../src/store/index';
import { makeEnv } from './fake-cloudflare';
import {
  allSegments,
  checkoutRecovery,
  e,
  firstTimeRecovery,
  gettingStarted,
  reengagement,
  u,
} from './fixtures';

/**
 * Ingest router over in-memory bindings: deploy routing, event triggers with
 * where/filter gates, entry-once, wake-up delivery, identify (profile wake +
 * segment re-evaluation) and the HTTP surface.
 */

const bundle = () =>
  compileBundle({ workflows: [checkoutRecovery, reengagement], segments: allSegments });

describe('deployBundle rejects a bundle that misdescribes itself', () => {
  /*
   * `wf:${contentHash}` is the address an in-flight journey reads its IR from,
   * so a hash that does not describe its content is a way to change what a
   * pinned instance runs: submit an edited flow under the old hash and the next
   * replay picks it up. Deploy used to take the caller's word for it.
   */
  test('an edited flow carrying its old hash is refused, and nothing is written', async () => {
    const { env, db } = makeEnv();
    const tampered = bundle();
    const target = tampered.workflows[0];
    const staleHash = target.contentHash;
    // Change what it executes; keep the hash it arrived with
    target.flow.push({ id: '99', type: 'exit', reason: 'injected' });

    await expect(deployBundle(env, tampered)).rejects.toThrow(/contentHash does not match/);

    expect(db.ir.size).toBe(0);
    expect(db.triggers).toHaveLength(0);
    expect(db.ir.get(staleHash)).toBeUndefined();
  });

  test('a tampered segment condition is refused too', async () => {
    const { env } = makeEnv();
    const tampered = bundle();
    tampered.segments[0].condition = { type: 'property', path: 'plan', op: 'eq', value: 'free' };

    await expect(deployBundle(env, tampered)).rejects.toThrow(/segment/);
  });

  test('an honest bundle still deploys', async () => {
    const { env, db } = makeEnv();
    await expect(deployBundle(env, bundle())).resolves.toBeDefined();
    expect(db.ir.size).toBeGreaterThan(0);
  });

  test('a metadata-only edit keeps its hash and redeploys in place', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());
    const storedKeys = [...db.ir.keys()];

    // Rewording a description must not move the hash
    const reworded = bundle();
    reworded.workflows[0].meta = { ...reworded.workflows[0].meta, description: 'new wording' };
    await expect(deployBundle(env, reworded)).resolves.toBeDefined();
    expect([...db.ir.keys()]).toEqual(storedKeys);
  });

  test('the HTTP surface reports it as the caller error, not a server fault', async () => {
    const { env } = makeEnv();
    const tampered = bundle();
    tampered.workflows[0].flow.push({ id: '99', type: 'exit' });

    const response = await handleRequest(
      new Request('https://x/deploy', { method: 'POST', body: JSON.stringify(tampered) }),
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('contentHash') });
  });
});

describe('deployBundle', () => {
  test('routes event and segment triggers, stores segments and workflow bodies', async () => {
    const { env, db } = makeEnv();

    const result = await deployBundle(env, bundle());

    expect(db.triggers).toHaveLength(1); // checkout_recovery (begin_checkout)
    expect(db.triggers[0]).toMatchObject({
      workflow: 'checkout_recovery',
      event: 'begin_checkout',
    });
    expect(db.segmentTriggers).toEqual([
      expect.objectContaining({ workflow: 'reengagement', segment: 'inactive_30d' }),
    ]);
    expect(db.segments.size).toBe(allSegments.length);
    expect(db.ir.size).toBe(2);
    expect(result.unrouted).toEqual([]);
  });

  test('reports workflows whose trigger type has no routing yet', async () => {
    const { env } = makeEnv();
    const holiday = workflow({ id: 'holiday', trigger: trigger.date('2026-12-25 09:00:00') }).email(
      gettingStarted
    );

    const result = await deployBundle(env, compileBundle({ workflows: [holiday] }));

    expect(result.unrouted).toEqual([{ workflow: 'holiday', trigger: 'date' }]);
  });

  test('redeploy swaps the routing tables instead of accumulating', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());
    await deployBundle(env, bundle());

    expect(db.triggers).toHaveLength(1);
    expect(db.segmentTriggers).toHaveLength(1);
  });
});

describe('event triggers', () => {
  test('starts a journey once; the entry ledger blocks re-entry', async () => {
    const { env, db, journey } = makeEnv();
    await deployBundle(env, bundle());

    const first = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' });
    // begin_checkout starts checkout_recovery; the user also has no login
    // history, so the inactive_30d segment trigger fires reengagement
    expect(first.started).toHaveLength(2);
    expect(journey.created.map((c) => c.id)).toEqual(first.started);
    expect(db.entries.map((entry) => entry.workflow).sort()).toEqual([
      'checkout_recovery',
      'reengagement',
    ]);

    const second = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' });
    expect(second.started).toEqual([]);
    expect(db.entries).toHaveLength(2);
  });

  test('the where gate rejects non-matching payloads before anything else', async () => {
    const { env } = makeEnv();
    const webOnly = workflow({
      id: 'web_only',
      trigger: trigger.event(e.sign_up, (p) => eq(p.method, 'google')),
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [webOnly] }));

    const rejected = await ingestEvent(env, {
      userId: 'u1',
      event: 'sign_up',
      payload: { method: 'email' },
    });
    expect(rejected.started).toEqual([]);

    const accepted = await ingestEvent(env, {
      userId: 'u1',
      event: 'sign_up',
      payload: { method: 'google' },
    });
    expect(accepted.started).toHaveLength(1);
  });

  test('the profile filter gates entry until the profile matches', async () => {
    const { env, db } = makeEnv();
    const activeOnly = workflow({
      id: 'active_only',
      trigger: trigger.event(e.sign_up, { filter: eq(u.subscription_status, 'active') }),
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [activeOnly] }));

    const before = await ingestEvent(env, { userId: 'u1', event: 'sign_up' });
    expect(before.started).toEqual([]);

    db.profiles.set('u1', JSON.stringify({ subscription_status: 'active' }));
    const after = await ingestEvent(env, { userId: 'u1', event: 'sign_up' });
    expect(after.started).toHaveLength(1);
  });

  test('reserved $ event names are rejected', async () => {
    const { env } = makeEnv();
    await expect(ingestEvent(env, { userId: 'u1', event: '$profile_updated' })).rejects.toThrow(
      /reserved/
    );
  });
});

describe('the sender decides what counts as the same event', () => {
  /*
   * Every count- and window-based condition reads the events log, so a second
   * copy of one event silently changes what a journey decides. Only the sender
   * knows whether two deliveries are one occurrence, so the id comes from them:
   * an HTTP client retrying a 500 and the interpreter's send_event step both
   * resend an id they can reproduce.
   */
  test('the same id is stored once, however often it arrives', async () => {
    const { env, db } = makeEnv();

    const first = await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:7' });
    const retry = await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:7' });

    expect(first.stored).toBe(true);
    expect(retry.stored).toBe(false);
    expect(retry.id).toBe('inst-1:7');
    expect(db.events).toHaveLength(1);
  });

  test('an id is per-occurrence, not per-event-name', async () => {
    const { env, db } = makeEnv();
    await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:7' });
    await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:9' });
    expect(db.events).toHaveLength(2);
  });

  test('two identical events a moment apart stay two events', async () => {
    // Nothing tells them apart but the sender's silence, which says they are distinct
    const { env, db } = makeEnv();
    const first = await ingestEvent(env, { userId: 'u1', event: 'purchase' });
    const second = await ingestEvent(env, { userId: 'u1', event: 'purchase' });

    expect(first.id).not.toBe(second.id);
    expect(db.events).toHaveLength(2);
  });

  test('an event sent without an id still gets one, and the caller is told which', async () => {
    const { env, db } = makeEnv();
    const result = await ingestEvent(env, { userId: 'u1', event: 'purchase' });

    expect(result.id).toEqual(expect.any(String));
    expect(db.events[0].id).toBe(result.id);
  });

  test('the retry still starts the journeys the first attempt never got to', async () => {
    const { env, db, journey } = makeEnv();
    await deployBundle(env, bundle());

    // The first attempt writes the row and then, as far as the caller knows, fails
    await ingestEvent(env, { userId: 'u1', event: 'begin_checkout', id: 'evt-1' });
    db.entries = [];
    journey.created.length = 0;

    const retry = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout', id: 'evt-1' });

    expect(retry.stored).toBe(false); // the event was already logged
    expect(retry.started.length).toBeGreaterThan(0); // but the journeys still start
    expect(db.events).toHaveLength(1);
  });
});

describe('an entry that never ran does not bar the user forever', () => {
  /*
   * The entries key is the once-policy, and it used to be absolute. A 'failed'
   * row records an instance that died, not a journey the user received, so
   * leaving it in place locks that user out of the workflow permanently over
   * one transient outage.
   */
  const enter = async () => {
    const { env, db, journey } = makeEnv();
    await deployBundle(
      env,
      compileBundle({ workflows: [checkoutRecovery], segments: allSegments })
    );
    await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' });
    expect(db.entries).toHaveLength(1);
    return { env, db, journey };
  };

  test('a failed entry is reclaimed by the next trigger', async () => {
    const { env, db, journey } = await enter();
    db.entries[0].status = 'failed';
    const deadInstance = db.entries[0].instance_id;

    const again = await ingestEvent(env, {
      userId: 'u1',
      event: 'begin_checkout',
      ts: Date.now() + 1,
    });

    expect(again.started).toHaveLength(1);
    expect(db.entries).toHaveLength(1); // reclaimed in place, not a second row
    expect(db.entries[0].status).toBe('running');
    expect(db.entries[0].instance_id).not.toBe(deadInstance);
    expect(journey.created).toHaveLength(2);
  });

  test('a running entry still blocks, which is the whole point of the ledger', async () => {
    const { env, db } = await enter();
    const again = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' });
    expect(again.started).toEqual([]);
    expect(db.entries[0].status).toBe('running');
  });

  test('a completed entry blocks too: the user did receive that journey', async () => {
    const { env, db } = await enter();
    db.entries[0].status = 'completed';
    const again = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' });
    expect(again.started).toEqual([]);
    expect(db.entries[0].status).toBe('completed');
  });
});

describe('segment-entry triggers', () => {
  test('fires on the not-matching → matching transition and tracks leave', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());

    // First activity: no login history → inactive_30d matches → enter
    const first = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' });
    expect(first.started.some((id) => id.startsWith('reengagement-'))).toBe(true);
    expect(db.segmentMembers.has('inactive_30d\nu2')).toBe(true);

    // A login makes the user active again → membership drops (no journey started)
    const login = await ingestEvent(env, { userId: 'u2', event: 'login' });
    expect(login.started).toEqual([]);
    expect(db.segmentMembers.has('inactive_30d\nu2')).toBe(false);

    // Entry-once still applies on any later re-entry transition
    expect(db.entries.filter((entry) => entry.workflow === 'reengagement')).toHaveLength(1);
  });

  test('a start that failed is retried by the next evaluation, behind the membership', async () => {
    const { env, db, journey } = makeEnv();
    await deployBundle(env, bundle());
    const create = journey.create.bind(journey);
    // Only the segment's workflow fails to start; the event-triggered one goes out
    journey.create = async (options) => {
      if (options.id.startsWith('reengagement-')) throw new Error('platform unavailable');
      return create(options);
    };

    // The entry is recorded, its start owed; the failure still reaches the caller
    await expect(ingestEvent(env, { userId: 'u2', event: 'begin_checkout' })).rejects.toThrow(
      'platform unavailable'
    );
    expect(db.segmentMembers.has('inactive_30d\nu2')).toBe(true);
    expect([...db.segmentStarts]).toContain('inactive_30d\nreengagement\nu2');

    // Next activity: already a member, but the owed start goes out now — once
    journey.create = create;
    const retry = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' });
    expect(retry.started.some((id) => id.startsWith('reengagement-'))).toBe(true);
    expect(db.segmentStarts.size).toBe(0);
    const again = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' });
    expect(again.started.some((id) => id.startsWith('reengagement-'))).toBe(false);
  });
});

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
      event: PROFILE_UPDATED_EVENT,
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
      event: PROFILE_UPDATED_EVENT,
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
    const { env, db } = makeEnv();
    db.subscriptions.push({
      user_id: 'u1',
      event: PROFILE_UPDATED_EVENT,
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
      event: PROFILE_UPDATED_EVENT,
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

/* ------------------------------ 4.0 host behavior ------------------------------ */

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('a user being erased is refused everywhere that writes about them', () => {
  /*
   * forgetUser records the request, stops the instances, then erases. Between the stop and the
   * erase a write would come back after it: an event re-creates the user, an identify a profile.
   */
  test('ingestEvent, identifyUser and registerDevice throw UserErasedError', async () => {
    const { env, db } = makeEnv();
    db.erasures.set('u1', 1);
    await expect(ingestEvent(env, { userId: 'u1', event: 'login' })).rejects.toBeInstanceOf(
      UserErasedError
    );
    expect(db.events).toEqual([]);
  });

  test('/events, /identify and /devices answer 410', async () => {
    const { env, db } = makeEnv();
    db.erasures.set('u1', 1);
    const requests = [
      post('/events', { userId: 'u1', event: 'login' }),
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      post('/devices', { userId: 'u1', token: 't1', platform: 'ios' }),
    ];
    for (const request of requests) {
      const response = await handleRequest(request, env);
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'user is being erased' });
    }
    expect(db.events).toEqual([]);
    expect(db.profiles.size).toBe(0);
    expect(db.devices.size).toBe(0);
    // Another user is not affected
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

  test('a wait on another property sleeps on; a pre-4.0 unscoped wait still wakes', async () => {
    const { env, db, journey } = makeEnv();
    for (const handle of ['inst-plan', 'inst-email', 'inst-legacy']) journey.known.add(handle);
    subscribe(db, 'inst-plan', profileUpdatedEvent('plan'));
    subscribe(db, 'inst-email', profileUpdatedEvent('email'));
    subscribe(db, 'inst-legacy', PROFILE_UPDATED_EVENT);

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro' } }),
      env
    );

    expect(await response.json()).toMatchObject({ woke: 2 });
    expect(journey.wakes.map((wake) => wake.id).sort()).toEqual(['inst-legacy', 'inst-plan']);
  });

  test('an instance subscribed to several patched properties is woken once', async () => {
    const { env, db, journey } = makeEnv();
    journey.known.add('inst-both');
    subscribe(db, 'inst-both', profileUpdatedEvent('plan'));
    subscribe(db, 'inst-both', profileUpdatedEvent('seats'));
    subscribe(db, 'inst-both', PROFILE_UPDATED_EVENT);

    const response = await handleRequest(
      post('/identify', { userId: 'u1', props: { plan: 'pro', seats: 5 } }),
      env
    );

    expect(await response.json()).toMatchObject({ woke: 1 });
    expect(journey.wakes).toEqual([{ id: 'inst-both', type: WAKE_EVENT_TYPE }]);
  });
});

describe('the sweep walks users page by page', () => {
  /** The store, with every listUserIds call recorded. */
  function recording(env: ReturnType<typeof makeEnv>['env']) {
    const store = d1Store(env);
    const pages: { after: string | undefined; limit: number | undefined }[] = [];
    const recorded = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'listUserIds') return Reflect.get(target, property, receiver);
        return async (page?: { after?: string; limit?: number }) => {
          pages.push({ after: page?.after, limit: page?.limit });
          return target.listUserIds(page);
        };
      },
    });
    return { store: recorded, pages };
  }

  test('1200 users are three pages of 500, resumed past the last id of each', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());
    for (let i = 0; i < 1200; i++) db.profiles.set(`u${String(i).padStart(4, '0')}`, '{}');
    const { store, pages } = recording(env);

    const result = await sweepSegments(env, store);

    expect(result.users).toBe(1200);
    expect(pages).toEqual([
      { after: undefined, limit: 500 },
      { after: 'u0499', limit: 500 },
      { after: 'u0999', limit: 500 },
    ]);
    // Everyone was evaluated exactly once: all 1200 have no login, so all entered inactive_30d
    expect(
      [...db.segmentMembers.keys()].filter((key) => key.startsWith('inactive_30d\n'))
    ).toHaveLength(1200);
  });

  test('exactly a full page is followed by one more, empty, page', async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < 500; i++) db.profiles.set(`u${String(i).padStart(4, '0')}`, '{}');
    const { store, pages } = recording(env);
    const result = await sweepSegments(env, store);
    expect(result.users).toBe(500);
    expect(pages.map((page) => page.after)).toEqual([undefined, 'u0499']);
  });

  test('one page reports where to resume and whether more follow', async () => {
    const { env, db } = makeEnv();
    for (const id of ['a', 'b', 'c']) db.profiles.set(id, '{}');
    const first = await sweepSegmentsPaged(env, d1Store(env), { limit: 2 });
    expect(first).toMatchObject({ users: 2, lastUserId: 'b', more: true });
    const last = await sweepSegmentsPaged(env, d1Store(env), { after: 'b', limit: 2 });
    expect(last).toMatchObject({ users: 1, lastUserId: 'c', more: false });
  });

  test('users being erased are listed but not evaluated', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());
    db.profiles.set('u1', '{}');
    db.profiles.set('u2', '{}');
    db.erasures.set('u2', 1);
    // u2's erasure finishes in maintenance (no running instance): nothing left to list
    const result = await sweepSegments(env, d1Store(env));
    expect(result.users).toBe(1);
    expect(db.profiles.has('u2')).toBe(false);
  });

  test('a store that ignores `after` cannot loop the sweep forever', async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < 3; i++) db.profiles.set(`u${i}`, '{}');
    const store = new Proxy(d1Store(env), {
      get: (target, property, receiver) =>
        property === 'listUserIds'
          ? (page?: { limit?: number }) => target.listUserIds({ limit: page?.limit })
          : Reflect.get(target, property, receiver),
    });
    await expect(sweepSegmentsPaged(env, store, { after: 'u1', limit: 2 })).rejects.toThrow(
      /did not advance/
    );
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
        if (id !== messageId) return false;
        unsubscribed.push(id);
        return true;
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
