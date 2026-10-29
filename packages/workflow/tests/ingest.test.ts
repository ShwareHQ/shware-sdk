import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
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
import type { JourneyStore } from '../src/store/index';
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
import { type PgliteDatabase, pgliteDatabase, truncateAll } from './pglite';
import { FakeCfStep } from './stubs/cf-step';

/**
 * Ingest over the fake Workflow binding and a Postgres store (PGlite): deploy routing, event
 * triggers with where/filter gates, entry-once, segment-entry triggers and the paged sweep. The
 * HTTP surface is http.test.ts.
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

/** How many rows the table holds, those matching `where` (SQL, no parameters) when given. */
const rows = async (table: string, where = 'TRUE') =>
  (
    await database.client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM workflow.${table} WHERE ${where}`
    )
  )[0].c;
/** The content hashes of the stored workflow bodies. */
const storedHashes = async () =>
  (
    await database.client.query<{ content_hash: string }>(
      'SELECT content_hash FROM workflow.ir ORDER BY content_hash'
    )
  ).map((row) => row.content_hash);
/** The entry ledger, by workflow. */
const entries = () =>
  database.client.query<{ workflow: string; instance_id: string; status: string }>(
    'SELECT workflow, instance_id, status FROM workflow.entry ORDER BY workflow'
  );
/** Profiles for `count` users, `u0000` onwards, in one statement. */
const profiles = (count: number) =>
  database.pg.query(
    `INSERT INTO workflow.profile (user_id, props)
       SELECT 'u' || lpad(i::text, 4, '0'), '{}'::jsonb FROM generate_series(0, $1 - 1) AS i`,
    [count]
  );

/** The engine's env and store, as the tests below take them. */
function setup(): ReturnType<typeof makeEnv> & { store: JourneyStore } {
  return { ...makeEnv(), store: database.store };
}

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
    const { env, store } = setup();
    const tampered = bundle();
    const target = tampered.workflows[0];
    const staleHash = target.contentHash;
    // Change what it executes; keep the hash it arrived with
    target.flow.push({ id: '99', type: 'exit', reason: 'injected' });

    await expect(deployBundle(env, tampered, store)).rejects.toThrow(/contentHash does not match/);

    expect(await rows('ir')).toBe(0);
    expect(await rows('trigger')).toBe(0);
    expect(await store.getWorkflowIR(staleHash)).toBeUndefined();
  });

  test('a tampered segment condition is refused too', async () => {
    const { env, store } = setup();
    const tampered = bundle();
    tampered.segments[0].condition = { type: 'property', path: 'plan', op: 'eq', value: 'free' };

    await expect(deployBundle(env, tampered, store)).rejects.toThrow(/segment/);
  });

  test('an honest bundle still deploys', async () => {
    const { env, store } = setup();
    await expect(deployBundle(env, bundle(), store)).resolves.toBeDefined();
    expect(await rows('ir')).toBeGreaterThan(0);
  });

  test('a metadata-only edit keeps its hash and redeploys in place', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    const storedKeys = await storedHashes();

    // Rewording a description must not move the hash
    const reworded = bundle();
    reworded.workflows[0].meta = { ...reworded.workflows[0].meta, description: 'new wording' };
    await expect(deployBundle(env, reworded, store)).resolves.toBeDefined();
    expect(await storedHashes()).toEqual(storedKeys);
  });

  test('the HTTP surface reports it as the caller error, not a server fault', async () => {
    const { env, store } = setup();
    env.ENVIRONMENT = 'development'; // no API_TOKEN: production would refuse with a 503
    const tampered = bundle();
    tampered.workflows[0].flow.push({ id: '99', type: 'exit' });

    const response = await handleRequest(
      new Request('https://x/deploy', { method: 'POST', body: JSON.stringify(tampered) }),
      env,
      store
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('contentHash') });
  });
});

describe('deployBundle', () => {
  test('routes event and segment triggers, stores segments and workflow bodies', async () => {
    const { env, store } = setup();

    const result = await deployBundle(env, bundle(), store);

    // checkout_recovery (begin_checkout)
    expect(await database.client.query('SELECT workflow, event FROM workflow.trigger')).toEqual([
      { workflow: 'checkout_recovery', event: 'begin_checkout' },
    ]);
    expect(await store.listSegmentTriggers()).toEqual([
      expect.objectContaining({ workflow: 'reengagement', segment: 'inactive_30d' }),
    ]);
    expect(await store.listSegments()).toHaveLength(allSegments.length);
    expect(await rows('ir')).toBe(2);
    expect(result.unrouted).toEqual([]);
  });

  test('reports workflows whose trigger type has no routing yet', async () => {
    const { env, store } = setup();
    const holiday = workflow({ id: 'holiday', trigger: trigger.date('2026-12-25 09:00:00') }).email(
      gettingStarted
    );

    const result = await deployBundle(env, compileBundle({ workflows: [holiday] }), store);

    expect(result.unrouted).toEqual([{ workflow: 'holiday', trigger: 'date' }]);
  });

  test('redeploy swaps the routing tables instead of accumulating', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    await deployBundle(env, bundle(), store);

    expect(await rows('trigger')).toBe(1);
    expect(await rows('segment_trigger')).toBe(1);
  });
});

describe('event triggers', () => {
  test('starts a journey once; the entry ledger blocks re-entry', async () => {
    const { env, store, journey } = setup();
    await deployBundle(env, bundle(), store);

    const first = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' }, store);
    // begin_checkout starts checkout_recovery; the user also has no login
    // history, so the inactive_30d segment trigger fires reengagement
    expect(first.started).toHaveLength(2);
    expect(journey.created.map((c) => c.id)).toEqual(first.started);
    expect((await entries()).map((entry) => entry.workflow)).toEqual([
      'checkout_recovery',
      'reengagement',
    ]);

    const second = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' }, store);
    expect(second.started).toEqual([]);
    expect(await rows('entry')).toBe(2);
  });

  test('the where gate rejects non-matching payloads before anything else', async () => {
    const { env, store } = setup();
    const webOnly = workflow({
      id: 'web_only',
      trigger: trigger.event(e.sign_up, (p) => eq(p.method, 'google')),
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [webOnly] }), store);

    const rejected = await ingestEvent(
      env,
      { userId: 'u1', event: 'sign_up', payload: { method: 'email' } },
      store
    );
    expect(rejected.started).toEqual([]);

    const accepted = await ingestEvent(
      env,
      { userId: 'u1', event: 'sign_up', payload: { method: 'google' } },
      store
    );
    expect(accepted.started).toHaveLength(1);
  });

  test('the profile filter gates entry until the profile matches', async () => {
    const { env, store } = setup();
    const activeOnly = workflow({
      id: 'active_only',
      trigger: trigger.event(e.sign_up, { filter: eq(u.subscription_status, 'active') }),
    }).email(firstTimeRecovery);
    await deployBundle(env, compileBundle({ workflows: [activeOnly] }), store);

    const before = await ingestEvent(env, { userId: 'u1', event: 'sign_up' }, store);
    expect(before.started).toEqual([]);

    await store.mergeProfile('u1', { subscription_status: 'active' });
    const after = await ingestEvent(env, { userId: 'u1', event: 'sign_up' }, store);
    expect(after.started).toHaveLength(1);
  });

  test('reserved $ event names are rejected', async () => {
    const { env, store } = setup();
    await expect(
      ingestEvent(env, { userId: 'u1', event: '$profile_updated' }, store)
    ).rejects.toThrow(/reserved/);
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
    const { env, store } = setup();

    const first = await ingestEvent(
      env,
      { userId: 'u1', event: 'purchase', id: 'inst-1:7' },
      store
    );
    const retry = await ingestEvent(
      env,
      { userId: 'u1', event: 'purchase', id: 'inst-1:7' },
      store
    );

    expect(first.stored).toBe(true);
    expect(retry.stored).toBe(false);
    expect(retry.id).toBe('inst-1:7');
    expect(await rows('event')).toBe(1);
  });

  test('an id is per-occurrence, not per-event-name', async () => {
    const { env, store } = setup();
    await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:7' }, store);
    await ingestEvent(env, { userId: 'u1', event: 'purchase', id: 'inst-1:9' }, store);
    expect(await rows('event')).toBe(2);
  });

  test('two identical events a moment apart stay two events', async () => {
    // Nothing tells them apart but the sender's silence, which says they are distinct
    const { env, store } = setup();
    const first = await ingestEvent(env, { userId: 'u1', event: 'purchase' }, store);
    const second = await ingestEvent(env, { userId: 'u1', event: 'purchase' }, store);

    expect(first.id).not.toBe(second.id);
    expect(await rows('event')).toBe(2);
  });

  test('an event sent without an id still gets one, and the caller is told which', async () => {
    const { env, store } = setup();
    const result = await ingestEvent(env, { userId: 'u1', event: 'purchase' }, store);

    expect(result.id).toEqual(expect.any(String));
    expect(await database.client.query('SELECT event_id FROM workflow.event')).toEqual([
      { event_id: result.id },
    ]);
  });

  test('the retry still starts the journeys the first attempt never got to', async () => {
    const { env, store, journey } = setup();
    await deployBundle(env, bundle(), store);

    // The first attempt writes the row and then, as far as the caller knows, fails
    await ingestEvent(env, { userId: 'u1', event: 'begin_checkout', id: 'evt-1' }, store);
    await database.pg.exec('DELETE FROM workflow.entry');
    journey.created.length = 0;

    const retry = await ingestEvent(
      env,
      { userId: 'u1', event: 'begin_checkout', id: 'evt-1' },
      store
    );

    expect(retry.stored).toBe(false); // the event was already logged
    expect(retry.started.length).toBeGreaterThan(0); // but the journeys still start
    expect(await rows('event')).toBe(1);
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
    const { env, store, journey } = setup();
    await deployBundle(
      env,
      compileBundle({ workflows: [checkoutRecovery], segments: allSegments }),
      store
    );
    await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' }, store);
    const [entry] = await entries();
    expect(await rows('entry')).toBe(1);
    return { env, store, journey, instanceId: entry.instance_id };
  };

  test('a failed entry is reclaimed by the next trigger', async () => {
    const { env, store, journey, instanceId: deadInstance } = await enter();
    await store.setEntryStatus(deadInstance, 'failed');

    const again = await ingestEvent(
      env,
      { userId: 'u1', event: 'begin_checkout', ts: Date.now() + 1 },
      store
    );

    expect(again.started).toHaveLength(1);
    const ledger = await entries();
    expect(ledger).toHaveLength(1); // reclaimed in place, not a second row
    expect(ledger[0].status).toBe('running');
    expect(ledger[0].instance_id).not.toBe(deadInstance);
    expect(journey.created).toHaveLength(2);
  });

  test('a running entry still blocks, which is the whole point of the ledger', async () => {
    const { env, store } = await enter();
    const again = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' }, store);
    expect(again.started).toEqual([]);
    expect((await entries())[0].status).toBe('running');
  });

  test('a completed entry blocks too: the user did receive that journey', async () => {
    const { env, store, instanceId } = await enter();
    await store.setEntryStatus(instanceId, 'completed');
    const again = await ingestEvent(env, { userId: 'u1', event: 'begin_checkout' }, store);
    expect(again.started).toEqual([]);
    expect((await entries())[0].status).toBe('completed');
  });
});

describe('segment-entry triggers', () => {
  test('fires on the not-matching → matching transition and tracks leave', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);

    // First activity: no login history → inactive_30d matches → enter
    const first = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' }, store);
    expect(first.started.some((id) => id.startsWith('reengagement-'))).toBe(true);
    expect(await store.isSegmentMember('inactive_30d', 'u2')).toBe(true);

    // A login makes the user active again → membership drops (no journey started)
    const login = await ingestEvent(env, { userId: 'u2', event: 'login' }, store);
    expect(login.started).toEqual([]);
    expect(await store.isSegmentMember('inactive_30d', 'u2')).toBe(false);

    // Entry-once still applies on any later re-entry transition
    expect(await rows('entry', "workflow = 'reengagement'")).toBe(1);
  });

  test('a start that failed is retried by the next evaluation, behind the membership', async () => {
    const { env, store, journey } = setup();
    await deployBundle(env, bundle(), store);
    const create = journey.create.bind(journey);
    // Only the segment's workflow fails to start; the event-triggered one goes out
    journey.create = async (options) => {
      if (options.id.startsWith('reengagement-')) throw new Error('platform unavailable');
      return create(options);
    };

    // The entry is recorded, its start owed; the failure still reaches the caller
    await expect(
      ingestEvent(env, { userId: 'u2', event: 'begin_checkout' }, store)
    ).rejects.toThrow('platform unavailable');
    expect(await store.isSegmentMember('inactive_30d', 'u2')).toBe(true);
    expect(await store.pendingSegmentStarts('inactive_30d', 'u2')).toContain('reengagement');

    // Next activity: already a member, but the owed start goes out now — once
    journey.create = create;
    const retry = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' }, store);
    expect(retry.started.some((id) => id.startsWith('reengagement-'))).toBe(true);
    expect(await rows('segment_start')).toBe(0);
    const again = await ingestEvent(env, { userId: 'u2', event: 'begin_checkout' }, store);
    expect(again.started.some((id) => id.startsWith('reengagement-'))).toBe(false);
  });
});

describe('the sweep walks users page by page', () => {
  /** The store, with every listUserIds call recorded. */
  function recording(store: JourneyStore) {
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

  // Every user is evaluated inside its own locked transaction, so this one takes seconds on
  // PGlite (and longer on a CI runner): a timeout of its own, not vitest's 5 s.
  test('1200 users are three pages of 500, resumed past the last id of each', async () => {
    const { env, store: base } = setup();
    await deployBundle(env, bundle(), base);
    await profiles(1200);
    const { store, pages } = recording(base);

    const result = await sweepSegments(env, store);

    expect(result.users).toBe(1200);
    expect(pages).toEqual([
      { after: undefined, limit: 500 },
      { after: 'u0499', limit: 500 },
      { after: 'u0999', limit: 500 },
    ]);
    // Everyone was evaluated exactly once: all 1200 have no login, so all entered inactive_30d
    expect(await rows('segment_member', "segment = 'inactive_30d'")).toBe(1200);
  }, 60_000);

  test('exactly a full page is followed by one more, empty, page', async () => {
    const { env, store: base } = setup();
    await profiles(500);
    const { store, pages } = recording(base);
    const result = await sweepSegments(env, store);
    expect(result.users).toBe(500);
    expect(pages.map((page) => page.after)).toEqual([undefined, 'u0499']);
  });

  test('one page reports where to resume and whether more follow', async () => {
    const { env, store } = setup();
    for (const id of ['a', 'b', 'c']) await store.mergeProfile(id, {});
    const first = await sweepSegmentsPaged(env, store, { limit: 2 });
    expect(first).toMatchObject({ users: 2, lastUserId: 'b', more: true });
    const last = await sweepSegmentsPaged(env, store, { after: 'b', limit: 2 });
    expect(last).toMatchObject({ users: 1, lastUserId: 'c', more: false });
  });

  test('users being erased are listed but not evaluated; erased ones are not listed', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    await store.mergeProfile('u1', {});
    await store.mergeProfile('u2', {});
    await store.requestErasure('u2', 1);
    // u2's erasure finishes in maintenance (no running instance): nothing left to list
    const result = await sweepSegments(env, store);
    expect(result.users).toBe(1);
    expect(await store.getProfile('u2')).toBeUndefined();
    expect(await store.erasureState('u2')).toBe('erased');
    expect(await rows('segment_member', "user_id = 'u2'")).toBe(0);

    // An erased user has no profile or event to be listed by, and no membership comes back
    const again = await sweepSegments(env, store);
    expect(again.users).toBe(1);
    expect(await rows('segment_member', "user_id = 'u2'")).toBe(0);
  });

  test('a store that ignores `after` cannot loop the sweep forever', async () => {
    const { env, store: base } = setup();
    await profiles(3);
    const store = new Proxy(base, {
      get: (target, property, receiver) =>
        property === 'listUserIds'
          ? (page?: { limit?: number }) => target.listUserIds({ limit: page?.limit })
          : Reflect.get(target, property, receiver),
    });
    await expect(sweepSegmentsPaged(env, store, { after: 'u0001', limit: 2 })).rejects.toThrow(
      /did not advance/
    );
  });
});

/* ------------------------- erasure against a late create ------------------------- */

/**
 * The erasure protocol against the runtime, through the real `journeyWorker` (its router and
 * its generated Runner). The ledger entry is committed before the platform is asked to create
 * the instance, so an erasure can land between the two: the entry is not admitted,
 * `forgetUser` finishes without a stop, and the runner that the late `create` eventually
 * produces meets the tombstone at admission and runs nothing.
 */

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
  transactional: true,
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
  const store = database.store;
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
  const userRows = (table: string, userId: string) => rows(table, `user_id = '${userId}'`);
  return { worker, env, journey, store, post, run, rows: userRows, actions, sent };
}

describe('erasing a user whose instance is still being created', () => {
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
