import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { d1Store } from '../src/cloudflare/d1-env';
import type { JourneyRunner } from '../src/cloudflare/runner';
import { journeyWorker } from '../src/cloudflare/worker';
import { handleRequest } from '../src/host/http';
import { deployBundle, ingestEvent, sweepSegments, sweepSegmentsPaged } from '../src/host/ingest';
import type {
  JourneyParams,
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/host/platform';
import {
  action,
  compileBundle,
  defineConfig,
  emailTemplate,
  eq,
  event,
  trigger,
  workflow,
} from '../src/index';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { renderPostgresDdl } from '../src/store/tables';
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
import { FakeCfStep } from './stubs/cf-step';

/**
 * Ingest over in-memory bindings: deploy routing, event triggers with where/filter gates,
 * entry-once, segment-entry triggers and the paged sweep. The HTTP surface is http.test.ts.
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

  test('users being erased are listed but not evaluated; erased ones are not listed', async () => {
    const { env, db } = makeEnv();
    await deployBundle(env, bundle());
    db.profiles.set('u1', '{}');
    db.profiles.set('u2', '{}');
    db.erasures.set('u2', { ts: 1, erased_at: null });
    // u2's erasure finishes in maintenance (no running instance): nothing left to list
    const result = await sweepSegments(env, d1Store(env));
    expect(result.users).toBe(1);
    expect(db.profiles.has('u2')).toBe(false);
    expect(db.erasures.get('u2')?.erased_at).not.toBeNull();
    expect([...db.segmentMembers.keys()].some((key) => key.endsWith('\nu2'))).toBe(false);

    // An erased user has no profile or event to be listed by, and no membership comes back
    const again = await sweepSegments(env, d1Store(env));
    expect(again.users).toBe(1);
    expect([...db.segmentMembers.keys()].some((key) => key.endsWith('\nu2'))).toBe(false);
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

/* ------------------------- erasure against a late create ------------------------- */

/**
 * The erasure protocol against the runtime, through the real `journeyWorker` (its router and
 * its generated Runner) on a Postgres store (PGlite). The ledger entry is committed before the
 * platform is asked to create the instance, so an erasure can land between the two: the entry
 * is not admitted, `forgetUser` finishes without a stop, and the runner that the late `create`
 * eventually produces meets the tombstone at admission and runs nothing.
 */

let pg: PGlite;
const client = (db: { query: PGlite['query'] }): SqlClientLike => ({
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    (await db.query<T>(text, [...params])).rows,
  transaction: (fn) => fn(client(db)),
});

beforeAll(async () => {
  pg = await PGlite.create();
}, 30_000);
afterAll(async () => {
  await pg.close();
});

/** A Workflow binding whose `create` can be parked, and whose instances can be terminated. */
class LateJourney implements WorkflowBindingLike {
  readonly created: { id: string; params: JourneyParams }[] = [];
  readonly known = new Set<string>();
  readonly terminated: string[] = [];
  /** Whether instances offer `terminate` (Cloudflare's do; a binding without it cannot stop). */
  canTerminate = true;
  private gate: { entered: () => void; released: Promise<void> } | undefined;

  /** Park the next `create` after the router committed the entry: `entered` resolves once it is in. */
  park(): { entered: Promise<void>; release: () => void } {
    let entered!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gate = { entered, released };
    return { entered: arrived, release };
  }

  async create(options: { id: string; params: JourneyParams }): Promise<WorkflowInstanceLike> {
    const gate = this.gate;
    if (gate !== undefined) {
      this.gate = undefined;
      gate.entered();
      await gate.released;
    }
    this.created.push(options);
    this.known.add(options.id);
    return this.instance(options.id);
  }

  async get(id: string): Promise<WorkflowInstanceLike> {
    if (!this.known.has(id)) throw new Error('instance.not_found');
    return this.instance(id);
  }

  private instance(id: string): WorkflowInstanceLike {
    return {
      id,
      sendEvent: async () => {},
      ...(this.canTerminate
        ? {
            terminate: async () => {
              this.terminated.push(id);
            },
          }
        : {}),
    };
  }
}

const te = event<{ login: Record<string, never> }>();
const hi = emailTemplate({
  id: 'hi',
  from: 'hi@acme.test',
  title: 'Hi',
  props: z.strictObject({}),
  subject: 'Hi',
  preview: {},
  component: () => createElement('p', null, 'hi'),
});

function lateCreateHost() {
  const actions: string[] = [];
  const record = action('record', async (_args, { userId }) => {
    actions.push(userId);
  });
  const flow = workflow({ id: 'w', trigger: trigger.event(te.login) })
    .run(record)
    .email(hi);
  const config = defineConfig({
    workflows: [flow],
    actions: [record],
    templates: { email: { hi } },
  });
  const sent: string[] = [];
  const journey = new LateJourney();
  const env = { JOURNEY: journey, ENVIRONMENT: 'development' };
  const store = new PostgresJourneyStore(client(pg));
  const worker = journeyWorker<typeof env>({
    email: () => ({
      send: async (email: { subject: string }) => {
        sent.push(email.subject);
        return {};
      },
    }),
    store: () => store,
    config,
  });
  const post = (path: string, body?: unknown) =>
    worker.fetch(
      new Request(`http://worker${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env
    );
  const Runner = worker.Runner as unknown as new (ctx: unknown, env: unknown) => JourneyRunner;
  const run = (created: { id: string; params: JourneyParams }, step = new FakeCfStep()) =>
    new Runner({}, env).run(
      { payload: created.params, instanceId: created.id, timestamp: new Date() },
      step as never
    );
  const rows = async (table: string, userId: string) =>
    (
      await pg.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM workflow.${table} WHERE user_id = $1`,
        [userId]
      )
    ).rows[0].c;
  return { worker, env, journey, store, post, run, rows, actions, sent };
}

describe('erasing a user whose instance is still being created', () => {
  beforeEach(async () => {
    await pg.exec('DROP SCHEMA IF EXISTS workflow CASCADE');
    await pg.exec(renderPostgresDdl());
  });

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  test('the entry is committed, the create lands after the erase, and the runner runs nothing', async () => {
    const warned = quiet();
    try {
      const h = lateCreateHost();
      await post('/bundle/deploy', h);

      const gate = h.journey.park();
      const ingesting = h.post('/events', { userId: 'u1', event: 'login', payload: {} });
      await gate.entered;
      // The entry is in and not admitted; the platform does not know the instance yet
      const running = await h.store.runningInstances('u1');
      expect(running).toEqual([{ instanceId: expect.any(String), admitted: false }]);
      await expect(h.env.JOURNEY.get(running[0].instanceId)).rejects.toThrow('instance.not_found');

      // Nothing to stop: the entry can never be admitted now
      const forget = await h.post('/users/forget', { userId: 'u1' });
      expect(await forget.json()).toEqual({ ok: true, erased: true, pending: [] });
      expect(h.journey.terminated).toEqual([]);
      expect(await h.store.erasureState('u1')).toBe('erased');
      expect(await h.rows('instance', 'u1')).toBe(0);
      expect(await h.rows('entry', 'u1')).toBe(0);

      // The create lands, the router reports the start, and the runtime runs the instance
      gate.release();
      expect(await (await ingesting).json()).toMatchObject({ started: [running[0].instanceId] });
      expect(h.journey.created.map((c) => c.id)).toEqual([running[0].instanceId]);
      const step = new FakeCfStep();
      await expect(h.run(h.journey.created[0], step)).resolves.toEqual({
        status: 'exited',
        reason: 'erased',
      });
      expect(step.names).toEqual([]);
      expect(h.actions).toEqual([]);
      expect(h.sent).toEqual([]);
      expect(await h.rows('instance', 'u1')).toBe(0);
      expect(await h.rows('entry', 'u1')).toBe(0);
      expect(await h.store.erasureState('u1')).toBe('erased');

      // Another user runs as ever
      await h.post('/identify', { userId: 'u2', props: { email: 'u2@acme.test' } });
      await h.post('/events', { userId: 'u2', event: 'login', payload: {} });
      await expect(h.run(h.journey.created[1])).resolves.toMatchObject({ status: 'completed' });
      expect(h.actions).toEqual(['u2']);
      expect(h.sent).toEqual(['Hi']);
    } finally {
      warned.mockRestore();
    }
  });

  test('an admitted instance is stopped before the erase; one the platform forgot counts as stopped', async () => {
    const warned = quiet();
    try {
      const h = lateCreateHost();
      await post('/bundle/deploy', h);
      await h.post('/events', { userId: 'u1', event: 'login', payload: {} });
      const [{ id }] = h.journey.created;
      // What the runner does first
      expect(await h.store.admitInstance(id, 'u1')).toBe(true);
      expect(await h.store.runningInstances('u1')).toEqual([{ instanceId: id, admitted: true }]);

      // The binding cannot terminate: nothing is erased, the instance is pending
      h.journey.canTerminate = false;
      expect(await (await h.post('/users/forget', { userId: 'u1' })).json()).toEqual({
        ok: true,
        erased: false,
        pending: [id],
      });
      expect(await h.store.erasureState('u1')).toBe('erasing');
      expect(await h.rows('event', 'u1')).toBe(1);
      expect(await h.rows('entry', 'u1')).toBe(1);

      // Terminated, then erased; a repeat has nothing left to do
      h.journey.canTerminate = true;
      expect(await (await h.post('/users/forget', { userId: 'u1' })).json()).toEqual({
        ok: true,
        erased: true,
        pending: [],
      });
      expect(h.journey.terminated).toEqual([id]);
      expect(await h.store.erasureState('u1')).toBe('erased');
      expect(await h.rows('event', 'u1')).toBe(0);
      expect(await h.rows('entry', 'u1')).toBe(0);
      expect(await (await h.post('/users/forget', { userId: 'u1' })).json()).toEqual({
        ok: true,
        erased: true,
        pending: [],
      });
      expect(h.journey.terminated).toEqual([id]);

      // An admitted instance the platform no longer knows did reach it and finished since
      await h.post('/events', { userId: 'u2', event: 'login', payload: {} });
      const second = h.journey.created[1].id;
      expect(await h.store.admitInstance(second, 'u2')).toBe(true);
      h.journey.known.delete(second);
      expect(await (await h.post('/users/forget', { userId: 'u2' })).json()).toEqual({
        ok: true,
        erased: true,
        pending: [],
      });
      expect(h.journey.terminated).toEqual([id]);
      expect(await h.store.erasureState('u2')).toBe('erased');
    } finally {
      warned.mockRestore();
    }
  });

  test('a failed instance reclaimed by a new one: the old admission is gone, and the new runner meets the tombstone', async () => {
    const warned = quiet();
    try {
      const h = lateCreateHost();
      await post('/bundle/deploy', h);
      await h.post('/events', { userId: 'u1', event: 'login', payload: {} });
      const [{ id: old }] = h.journey.created;
      expect(await h.store.admitInstance(old, 'u1')).toBe(true);
      // The instance died: its entry failed, the admission still on the row
      await h.store.setEntryStatus(old, 'failed');

      // The next event reclaims the entry under a new instance id: a fresh attempt, not admitted
      const again = await (
        await h.post('/events', { userId: 'u1', event: 'login', payload: {} })
      ).json();
      const fresh = h.journey.created[1].id;
      expect(fresh).not.toBe(old);
      expect(again).toMatchObject({ started: [fresh] });
      expect(await h.store.runningInstances('u1')).toEqual([
        { instanceId: fresh, admitted: false },
      ]);
      // The old id cannot run under the reclaimed entry
      expect(await h.store.admitInstance(old, 'u1')).toBe(false);

      // Nothing to stop: the erasure completes at once
      expect(await (await h.post('/users/forget', { userId: 'u1' })).json()).toEqual({
        ok: true,
        erased: true,
        pending: [],
      });
      expect(h.journey.terminated).toEqual([]);
      expect(await h.rows('entry', 'u1')).toBe(0);
      expect(await h.rows('event', 'u1')).toBe(0);

      // A late run of the new instance exits without an effect
      const step = new FakeCfStep();
      await expect(h.run(h.journey.created[1], step)).resolves.toEqual({
        status: 'exited',
        reason: 'erased',
      });
      expect(step.names).toEqual([]);
      expect(h.actions).toEqual([]);
      expect(h.sent).toEqual([]);
      expect(await h.rows('entry', 'u1')).toBe(0);
      expect(await h.store.erasureState('u1')).toBe('erased');
    } finally {
      warned.mockRestore();
    }
  });
});

async function post(path: string, h: ReturnType<typeof lateCreateHost>) {
  const response = await h.post(path);
  expect(response.status).toBe(200);
}
