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

describe('deployBundle rejects a bundle that misdescribes itself', () => {
  /*
   * `wf:${contentHash}` is the address an in-flight journey reads its IR from,
   * so a hash that does not describe its content is a way to change what a
   * pinned instance runs: submit an edited flow under the old hash and the next
   * replay picks it up. Deploy used to take the caller's word for it.
   */
  test('an edited flow carrying its old hash is refused, and nothing is written', async () => {
    const { env, db, kv } = makeEnv();
    const tampered = bundle();
    const target = tampered.workflows[0];
    const staleHash = target.contentHash;
    // Change what it executes; keep the hash it arrived with
    target.flow.push({ id: '99', type: 'exit', reason: 'injected' });

    await expect(deployBundle(env, tampered)).rejects.toThrow(/contentHash does not match/);

    expect(kv.store.size).toBe(0);
    expect(db.triggers).toHaveLength(0);
    expect(kv.store.get(`wf:${staleHash}`)).toBeUndefined();
  });

  test('a tampered segment condition is refused too', async () => {
    const { env } = makeEnv();
    const tampered = bundle();
    tampered.segments[0].condition = { type: 'property', path: 'plan', op: 'eq', value: 'free' };

    await expect(deployBundle(env, tampered)).rejects.toThrow(/segment/);
  });

  test('an honest bundle still deploys', async () => {
    const { env, kv } = makeEnv();
    await expect(deployBundle(env, bundle())).resolves.toBeDefined();
    expect(kv.store.size).toBeGreaterThan(0);
  });

  test('a metadata-only edit keeps its hash and redeploys in place', async () => {
    const { env, kv } = makeEnv();
    await deployBundle(env, bundle());
    const storedKeys = [...kv.store.keys()];

    // Rewording a description must not move the hash
    const reworded = bundle();
    reworded.workflows[0].meta = { ...reworded.workflows[0].meta, description: 'new wording' };
    await expect(deployBundle(env, reworded)).resolves.toBeDefined();
    expect([...kv.store.keys()]).toEqual(storedKeys);
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

describe('a replayed ingest does not duplicate the event', () => {
  /*
   * Every count- and window-based condition reads the events log, so a second
   * copy of one event silently changes what a journey decides. Ingest is
   * reachable from two retrying callers: an HTTP client retrying a 500, and the
   * interpreter's send_event step being retried after it already committed its
   * row.
   */
  test('the same key is stored once, however often it arrives', async () => {
    const { env, db } = makeEnv();

    const first = await ingestEvent(env, {
      userId: 'u1',
      event: 'purchase',
      dedupeKey: 'inst-1:7',
    });
    const retry = await ingestEvent(env, {
      userId: 'u1',
      event: 'purchase',
      dedupeKey: 'inst-1:7',
    });

    expect(first.stored).toBe(true);
    expect(retry.stored).toBe(false);
    expect(db.events).toHaveLength(1);
  });

  test('a key is per-occurrence, not per-event-name', async () => {
    const { env, db } = makeEnv();
    await ingestEvent(env, { userId: 'u1', event: 'purchase', dedupeKey: 'inst-1:7' });
    await ingestEvent(env, { userId: 'u1', event: 'purchase', dedupeKey: 'inst-1:9' });
    expect(db.events).toHaveLength(2);
  });

  test('without a key nothing is collapsed, because nothing identifies the occurrence', async () => {
    const { env, db } = makeEnv();
    await ingestEvent(env, { userId: 'u1', event: 'purchase' });
    await ingestEvent(env, { userId: 'u1', event: 'purchase' });
    expect(db.events).toHaveLength(2);
  });

  test('the retry still starts the journeys the first attempt never got to', async () => {
    const { env, db, journey } = makeEnv();
    await deployBundle(env, bundle());

    // The first attempt writes the row and then, as far as the caller knows, fails
    await ingestEvent(env, { userId: 'u1', event: 'begin_checkout', dedupeKey: 'evt-1' });
    db.entries = [];
    journey.created.length = 0;

    const retry = await ingestEvent(env, {
      userId: 'u1',
      event: 'begin_checkout',
      dedupeKey: 'evt-1',
    });

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
