import { describe, expect, test } from 'vitest';
import { WAKE_EVENT_TYPE } from '../src/cloudflare/bindings';
import { deployBundle, handleRequest, ingestEvent } from '../src/cloudflare/router';
import { PROFILE_UPDATED_EVENT } from '../src/engine/condition';
import { compileBundle, eq, segment, trigger, workflow } from '../src/index';
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

describe('deployBundle', () => {
  test('routes event and segment triggers, stores segments and KV bodies', async () => {
    const { env, db, kv } = makeEnv();

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
    expect([...kv.store.keys()].every((key) => key.startsWith('wf:'))).toBe(true);
    expect(kv.store.size).toBe(2);
    expect(result.unrouted).toEqual([]);
  });

  test('reports workflows whose trigger type has no routing yet', async () => {
    const { env } = makeEnv();
    const holiday = workflow('holiday', { trigger: trigger.date('2026-12-25 09:00:00') }).email(
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
    const webOnly = workflow('web_only', {
      trigger: trigger.event(e.sign_up, { where: (p) => eq(p.method, 'google') }),
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
    const activeOnly = workflow('active_only', {
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

  test('a profile change can move the user into a trigger-routed segment', async () => {
    const { env, db } = makeEnv();
    const vip = segment('vip', eq(u.subscription_plan, 'business'));
    const vipWelcome = workflow('vip_welcome', { trigger: trigger.segment(vip) }).email(
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
