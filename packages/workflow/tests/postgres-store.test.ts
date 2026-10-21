import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { cloudflareJourneyBinding } from '../src/cloudflare/bindings';
import {
  deployBundle,
  identifyUser,
  ingestEvent,
  registerDevice,
  removeDevice,
  unbindDevice,
} from '../src/host/ingest';
import type { JourneyEnv } from '../src/host/platform';
import {
  compileBundle,
  eq,
  event,
  performed,
  segment,
  trigger,
  user,
  workflow,
} from '../src/index';
import { JourneyFactSource } from '../src/store/facts';
import { UserErasedError } from '../src/store/index';
import { PostgresJourneyStore, type SqlClientLike, uuidv7 } from '../src/store/postgres';
import { TABLES, renderDrizzleSchema, renderPostgresDdl } from '../src/store/tables';
import { FakeJourney } from './fake-cloudflare';
import { plainEmail } from './fixtures';

/**
 * PostgresJourneyStore against a real Postgres (PGlite, in-process) through
 * the same router the D1 store is tested with — the contract is the behaviour
 * the router relies on: atomic once-policy entries, idempotent subscriptions,
 * jsonb profile merges with null as "unset", timestamptz windows, and the
 * route swap.
 */

const schemaSql = renderPostgresDdl();

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
        ? fn(client(db)) // already inside one: PGlite transactions do not nest
        : db.transaction((tx) => fn(client({ query: tx.query.bind(tx) }))),
  };
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(schemaSql);
}, 30_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    `TRUNCATE ${Object.values(TABLES)
      .map((t) => `workflow."${t.name}"`)
      .join(', ')}`
  );
});

interface Event {
  signed_up: Record<string, never>;
  purchase: { value: number };
}
interface UserProperty {
  userId: string;
  email: string;
  plan: string;
}
const e = event<Event>();
const u = user<UserProperty>();
const welcome = plainEmail('welcome');
const pro = segment({ id: 'pro', condition: eq(u.plan, 'pro') });
const purchased = segment({ id: 'purchased', condition: performed(e.purchase) });

const welcomeFlow = workflow({ id: 'welcome', trigger: trigger.event(e.signed_up) }).email(welcome);
const proNudge = workflow({
  id: 'pro_nudge',
  trigger: trigger.segment(pro),
  goal: purchased,
}).email(welcome);
const bundle = () =>
  compileBundle({ workflows: [welcomeFlow, proNudge], segments: [pro, purchased] });

function setup() {
  const journey = new FakeJourney();
  const env: JourneyEnv = { JOURNEY: cloudflareJourneyBinding(journey) };
  const store = new PostgresJourneyStore(client(pg));
  return { env, journey, store };
}

describe('deploy', () => {
  test('stores workflow bodies and swaps the routing tables', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    await deployBundle(env, bundle(), store);

    expect(await store.findTriggers('signed_up')).toMatchObject([
      { workflow: 'welcome', where: null, filter: null },
    ]);
    expect(await store.listSegmentTriggers()).toMatchObject([
      { workflow: 'pro_nudge', segment: 'pro' },
    ]);
    expect(await store.getSegmentCondition('purchased')).toMatchObject({ type: 'performed' });
    const ir = await store.getWorkflowIR(welcomeFlow.toIR().contentHash);
    expect(ir?.id).toBe('welcome');
    expect(await store.getWorkflowIR('nope')).toBeUndefined();
  });

  test('a versioned deploy goes live only over an older version', async () => {
    const { env, store } = setup();
    const older = compileBundle({ workflows: [welcomeFlow], segments: [] });
    const v1 = { id: 'v1', createdAt: Date.parse('2026-10-01T00:00:00.000Z') };
    const v2 = { id: 'v2', createdAt: Date.parse('2026-10-02T00:00:00.000Z') };
    expect(await store.liveBundleVersion()).toBeUndefined();

    expect(await deployBundle(env, bundle(), store, v2)).toMatchObject({ applied: true });
    expect(await store.liveBundleVersion()).toEqual(v2);

    // v1 still serving during the rollout: its bundle never replaces v2's
    expect(await deployBundle(env, older, store, v1)).toMatchObject({ applied: false });
    // Nor does v2 again (another isolate of the same version)
    expect(await deployBundle(env, older, store, v2)).toMatchObject({ applied: false });
    expect(await store.liveBundleVersion()).toEqual(v2);
    expect(await store.listSegmentTriggers()).toMatchObject([{ workflow: 'pro_nudge' }]);

    // A forced deploy swaps the routes and leaves the recorded version as it was
    expect(await deployBundle(env, older, store)).toMatchObject({ applied: true });
    expect(await store.listSegmentTriggers()).toEqual([]);
    expect(await store.liveBundleVersion()).toEqual(v2);
  });
});

describe('ingest', () => {
  test('starts the routed journey once; the ledger blocks re-entry atomically', async () => {
    const { env, journey, store } = setup();
    await deployBundle(env, bundle(), store);

    const first = await ingestEvent(env, { userId: 'u1', event: 'signed_up' }, store);
    const second = await ingestEvent(env, { userId: 'u1', event: 'signed_up' }, store);

    expect(first.started).toHaveLength(1);
    expect(second.started).toEqual([]);
    expect(journey.created.map((c) => c.id)).toEqual(first.started);
    expect(await store.countEvents('u1', 'signed_up')).toBe(2);
  });

  test('rolls the entry back when the workflow runtime rejects the instance', async () => {
    const { env, journey, store } = setup();
    await deployBundle(env, bundle(), store);
    journey.create = async () => {
      throw new Error('rate limited');
    };

    await expect(ingestEvent(env, { userId: 'u1', event: 'signed_up' }, store)).rejects.toThrow(
      'rate limited'
    );
    expect(
      await store.enterJourney({
        workflow: 'welcome',
        userId: 'u1',
        instanceId: 'x',
        hash: 'h',
        ts: 1,
      })
    ).toBe('entered');
  });

  test('a repeated event id is a no-op that still routes', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    const first = await ingestEvent(env, { id: 'evt-1', userId: 'u1', event: 'signed_up' }, store);
    const again = await ingestEvent(env, { id: 'evt-1', userId: 'u1', event: 'signed_up' }, store);
    expect(first).toMatchObject({ id: 'evt-1', stored: true });
    expect(again).toMatchObject({ id: 'evt-1', stored: false, started: [] });
    expect(await store.countEvents('u1', 'signed_up')).toBe(1);
    const rows = await pg.query<{ event_id: string }>('SELECT event_id FROM workflow.event');
    expect(rows.rows).toEqual([{ event_id: 'evt-1' }]);
  });

  test('an event id is per user: the same id from another user is its own event', async () => {
    const { env, store } = setup();
    await deployBundle(env, bundle(), store);
    const row = (userId: string) => ({ id: 'evt-1', userId, event: 'signed_up' });
    expect(await ingestEvent(env, row('u1'), store)).toMatchObject({ stored: true });
    expect(await ingestEvent(env, row('u2'), store)).toMatchObject({ stored: true });
    expect(await ingestEvent(env, row('u2'), store)).toMatchObject({ stored: false });
    expect(await store.countEvents('u1', 'signed_up')).toBe(1);
    expect(await store.countEvents('u2', 'signed_up')).toBe(1);
  });

  test('a null in the profile patch removes the property', async () => {
    const { store } = setup();
    await store.mergeProfile('u1', { plan: 'pro', email: 'a@b.c' });
    expect(await store.mergeProfile('u1', { plan: null, name: 'Ann' })).toEqual({
      email: 'a@b.c',
      name: 'Ann',
    });
    expect(await store.mergeProfile('u2', { gone: null, kept: 1 })).toEqual({ kept: 1 });
  });

  test('the profile merge is top-level: an object value replaces the stored one whole', async () => {
    const { store } = setup();
    await store.mergeProfile('u1', { address: { city: 'Oslo', zip: '0150' } } as never);
    expect(await store.mergeProfile('u1', { address: { city: 'Bergen' } } as never)).toEqual({
      address: { city: 'Bergen' },
    });
  });

  test('user ids page in ascending order past the last id seen', async () => {
    const { store } = setup();
    await store.mergeProfile('u3', { a: 1 });
    await store.insertEvent({ id: 'e', userId: 'u1', event: 'x', ts: 1, payload: {} });
    await store.insertEvent({ id: 'e', userId: 'u2', event: 'x', ts: 1, payload: {} });
    await store.mergeProfile('u2', { a: 1 });
    expect(await store.listUserIds()).toEqual(['u1', 'u2', 'u3']);
    expect(await store.listUserIds({ limit: 2 })).toEqual(['u1', 'u2']);
    expect(await store.listUserIds({ after: 'u2', limit: 2 })).toEqual(['u3']);
    expect(await store.listUserIds({ after: 'u3' })).toEqual([]);
  });

  test('a failed entry is reclaimed, a live one is not', async () => {
    const { store } = setup();
    const entry = { workflow: 'welcome', userId: 'u1', hash: 'h' };
    expect(await store.enterJourney({ ...entry, instanceId: 'i1', ts: 1 })).toBe('entered');
    expect(await store.enterJourney({ ...entry, instanceId: 'i2', ts: 2 })).toBeNull();
    await store.setEntryStatus('i1', 'failed');
    expect(await store.enterJourney({ ...entry, instanceId: 'i2', ts: 2 })).toBe('reclaimed');
    const rows = await pg.query<{ instance_id: string; status: string }>(
      'SELECT instance_id, status FROM workflow.entry'
    );
    expect(rows.rows).toEqual([{ instance_id: 'i2', status: 'running' }]);
  });

  test('counts and payloads honour the since window (timestamptz)', async () => {
    const { store } = setup();
    await store.insertEvent({
      id: 'e1',
      userId: 'u1',
      event: 'purchase',
      ts: 1_000,
      payload: { value: 5 },
    });
    await store.insertEvent({
      id: 'e2',
      userId: 'u1',
      event: 'purchase',
      ts: 5_000,
      payload: { value: 50 },
    });

    expect(await store.countEvents('u1', 'purchase')).toBe(2);
    // Stored as a jsonb object, not a JSON string — drivers that serialize jsonb parameters
    // themselves (postgres.js) would otherwise double-encode; the ::text::jsonb cast prevents it.
    const typed = await pg.query<{ t: string }>(
      "SELECT jsonb_typeof(payload) AS t FROM workflow.event WHERE user_id = 'u1' LIMIT 1"
    );
    expect(typed.rows).toEqual([{ t: 'object' }]);
    expect(await store.countEvents('u1', 'purchase', { sinceMs: 2_000 })).toBe(1);
    expect(await store.listEventPayloads('u1', 'purchase', { sinceMs: 2_000 })).toEqual([
      { value: 50 },
    ]);
  });
});

describe('identify', () => {
  test('merges properties in the database, null unsets, and enters segments', async () => {
    const { env, journey, store } = setup();
    await deployBundle(env, bundle(), store);
    const facts = new JourneyFactSource(store, 'u1');

    const first = await identifyUser(env, 'u1', { email: 'a@example.com' }, store);
    expect(first.started).toEqual([]);

    const second = await identifyUser(env, 'u1', { plan: 'pro' }, store);
    expect(second.props).toEqual({ email: 'a@example.com', plan: 'pro' });
    expect(second.started).toHaveLength(1);
    expect(journey.created[0]?.params).toMatchObject({ workflowId: 'pro_nudge' });
    expect(await store.isSegmentMember('pro', 'u1')).toBe(true);

    const third = await identifyUser(env, 'u1', { plan: null }, store);
    expect(third.props).toEqual({ email: 'a@example.com' });
    expect(await facts.getProperty('plan')).toBeUndefined();
    expect(await store.isSegmentMember('pro', 'u1')).toBe(false);
  });
});

describe('subscriptions and entries', () => {
  test('subscribe is idempotent per (handle, event); unsubscribe drops the handle', async () => {
    const { env, journey, store } = setup();
    await store.subscribe('inst-1', 'u1', ['purchase', 'signed_up'], 1);
    await store.subscribe('inst-1', 'u1', ['purchase'], 2);
    await store.subscribe('inst-2', 'u1', ['purchase'], 3);

    expect((await store.findWakeHandles('u1', 'purchase')).sort()).toEqual(['inst-1', 'inst-2']);
    expect(await store.findWakeHandles('u1', 'signed_up')).toEqual(['inst-1']);

    // Waking goes through the runtime; an unknown handle is dropped, a known one is woken.
    journey.known.add('inst-2');
    const result = await ingestEvent(env, { userId: 'u1', event: 'purchase' }, store);
    expect(result.woke).toBe(1);
    expect(await store.findWakeHandles('u1', 'purchase')).toEqual(['inst-2']);

    await store.unsubscribe('inst-2');
    expect(await store.findWakeHandles('u1', 'purchase')).toEqual([]);
  });

  test('entry status is updated by instance id', async () => {
    const { store } = setup();
    await store.enterJourney({
      workflow: 'welcome',
      userId: 'u1',
      instanceId: 'i1',
      hash: 'h',
      ts: 1,
    });
    await store.setEntryStatus('i1', 'completed');
    const rows = await pg.query<{ status: string }>('SELECT status FROM workflow.entry');
    expect(rows.rows).toEqual([{ status: 'completed' }]);
    await store.removeEntry('i1');
    expect(
      await store.enterJourney({
        workflow: 'welcome',
        userId: 'u1',
        instanceId: 'i2',
        hash: 'h',
        ts: 2,
      })
    ).toBe('entered');
  });
});

describe('devices', () => {
  test('a token belongs to the latest user it was registered for, newest first', async () => {
    const { env, store } = setup();
    await registerDevice(env, { userId: 'u1', token: 'a', platform: 'ios', ts: 1 }, store);
    await registerDevice(env, { userId: 'u1', token: 'b', platform: 'android', ts: 2 }, store);
    await registerDevice(env, { userId: 'u2', token: 'a', platform: 'ios', ts: 3 }, store);
    expect(await store.listDevices('u1')).toEqual([{ token: 'b', platform: 'android' }]);
    expect(await store.listDevices('u2')).toEqual([{ token: 'a', platform: 'ios' }]);
    expect(await new JourneyFactSource(store, 'u2').listDevices()).toEqual([
      { token: 'a', platform: 'ios' },
    ]);
  });

  test('removing a token forgets it and reports its owner', async () => {
    const { env, store } = setup();
    await registerDevice(env, { userId: 'u1', token: 'a', platform: 'ios', ts: 1 }, store);
    expect(await removeDevice(env, 'a', store)).toEqual({ ok: true, woke: 0 });
    expect(await store.listDevices('u1')).toEqual([]);
    expect(await store.removeDevice('a')).toBeUndefined();
  });

  test('signing out unbinds the token, kept for the next sign-in to bind again', async () => {
    const { env, store } = setup();
    await registerDevice(env, { userId: 'u1', token: 'a', platform: 'ios', ts: 1 }, store);
    expect(await unbindDevice(env, 'a', store)).toEqual({ ok: true, woke: 0 });
    expect(await store.listDevices('u1')).toEqual([]);
    // Still registered, bound to nobody: unbinding again has no owner to report
    expect(await store.unbindDevice('a')).toBeUndefined();
    expect(await store.removeDevice('a')).toBeUndefined();
    await registerDevice(env, { userId: 'u2', token: 'a', platform: 'ios', ts: 2 }, store);
    expect(await store.listDevices('u2')).toEqual([{ token: 'a', platform: 'ios' }]);
  });
});

describe('erasure', () => {
  const erasureRows = async () =>
    (
      await pg.query<{ user_id: string; erased: boolean }>(
        'SELECT user_id, erased_at IS NOT NULL AS erased FROM workflow.erasure ORDER BY user_id'
      )
    ).rows;

  test('erasing from the request until forgetUser, which keeps the tombstone and the suppressions', async () => {
    const { env, store } = setup();
    await registerDevice(env, { userId: 'u1', token: 'a', platform: 'ios', ts: 1 }, store);
    await store.insertEvent({ id: 'e', userId: 'u1', event: 'x', ts: 1, payload: {} });
    await store.mergeProfile('u1', { plan: 'pro' });
    await store.subscribe('i1', 'u1', ['x'], 1);
    await store.addSegmentMember('s', 'u1', 1, ['w']);
    await store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i1', hash: 'h', ts: 1 });
    await store.mergeProfile('u2', { plan: 'free' });
    await pg.query(
      "INSERT INTO workflow.suppression (user_id, channel, ts) VALUES ('u1', 'email', now())"
    );

    expect(await store.erasureState('u1')).toBe('none');
    await store.requestErasure('u1', 5);
    await store.requestErasure('u1', 6);
    expect(await store.erasureState('u1')).toBe('erasing');
    expect(await store.pendingErasures()).toEqual(['u1']);
    expect(await store.runningInstances('u1')).toEqual(['i1']);

    await store.forgetUser('u1', 7);
    expect(await store.erasureState('u1')).toBe('erased');
    expect(await store.pendingErasures()).toEqual([]);
    expect(await erasureRows()).toEqual([{ user_id: 'u1', erased: true }]);
    expect(await store.getProfile('u1')).toBeUndefined();
    expect(await store.countEvents('u1', 'x')).toBe(0);
    expect(await store.listDevices('u1')).toEqual([]);
    expect(await store.findWakeHandles('u1', 'x')).toEqual([]);
    expect(await store.isSegmentMember('s', 'u1')).toBe(false);
    expect(await store.pendingSegmentStarts('s', 'u1')).toEqual([]);
    expect(await store.runningInstances('u1')).toEqual([]);
    expect(await store.listUserIds()).toEqual(['u2']);
    // An opt-out is a compliance record keyed by an opaque id: it outlives the erasure
    expect(await store.isSuppressed('u1', 'email')).toBe(true);

    // Erasing again: nothing to erase, the tombstone keeps its first time
    await store.requestErasure('u1', 8);
    expect(await store.erasureState('u1')).toBe('erased');
    await store.forgetUser('u1', 9);
    const [row] = (
      await pg.query<{ at: string }>(
        "SELECT (extract(epoch FROM erased_at) * 1000)::bigint::text AS at FROM workflow.erasure WHERE user_id = 'u1'"
      )
    ).rows;
    expect(row.at).toBe('7');
  });

  test.each(['erasing', 'erased'] as const)(
    'every write about a user with a tombstone (%s) is refused by the statement itself',
    async (state) => {
      const { store } = setup();
      await store.mergeProfile('u2', { plan: 'free' });
      // An entry of u1 that died, to show the reclaim is gated like the insert
      await store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i0', hash: 'h', ts: 1 });
      await store.setEntryStatus('i0', 'failed');
      // The tombstone lands after any pre-check a caller made
      await store.requestErasure('u1', 5);
      if (state === 'erased') await store.forgetUser('u1', 6);
      const entriesBefore = (await pg.query('SELECT 1 FROM workflow.entry')).rows.length;

      await expect(
        store.insertEvent({ id: 'e1', userId: 'u1', event: 'x', ts: 7, payload: {} })
      ).rejects.toBeInstanceOf(UserErasedError);
      await expect(store.mergeProfile('u1', { plan: 'pro' })).rejects.toBeInstanceOf(
        UserErasedError
      );
      await expect(
        store.upsertDevice({ userId: 'u1', token: 't', platform: 'ios', ts: 7 })
      ).rejects.toBeInstanceOf(UserErasedError);
      await expect(store.addSegmentMember('s', 'u1', 7, ['w'])).rejects.toBeInstanceOf(
        UserErasedError
      );
      await expect(
        store.enterJourney({ workflow: 'w', userId: 'u1', instanceId: 'i1', hash: 'h', ts: 7 })
      ).rejects.toBeInstanceOf(UserErasedError);
      await expect(
        store.enterJourney({ workflow: 'w2', userId: 'u1', instanceId: 'i2', hash: 'h', ts: 7 })
      ).rejects.toBeInstanceOf(UserErasedError);
      await expect(
        store.enterJourney({
          workflow: 'w3',
          userId: 'u1',
          instanceId: 'i3',
          hash: 'h',
          ts: 7,
          execution: { name: 'n', target: 't', input: '{}' },
        })
      ).rejects.toBeInstanceOf(UserErasedError);
      await expect(store.subscribe('i1', 'u1', ['x'], 7)).rejects.toBeInstanceOf(UserErasedError);

      // Nothing written, and nothing of anyone else touched
      expect(await store.countEvents('u1', 'x')).toBe(0);
      expect(await store.getProfile('u1')).toBeUndefined();
      expect(await store.listDevices('u1')).toEqual([]);
      expect(await store.isSegmentMember('s', 'u1')).toBe(false);
      expect(await store.pendingSegmentStarts('s', 'u1')).toEqual([]);
      expect(await store.findWakeHandles('u1', 'x')).toEqual([]);
      expect((await pg.query('SELECT 1 FROM workflow.entry')).rows).toHaveLength(entriesBefore);
      expect(await store.executions.get('i3')).toBeUndefined();
      expect(await store.getProfile('u2')).toEqual({ plan: 'free' });
      await store.mergeProfile('u2', { plan: 'pro' });
      expect(
        await store.insertEvent({ id: 'e1', userId: 'u2', event: 'x', ts: 7, payload: {} })
      ).toBe(true);
    }
  );

  test('a duplicate event and a taken entry stay plain no-ops without a tombstone', async () => {
    const { store } = setup();
    const row = { id: 'e1', userId: 'u1', event: 'x', ts: 1, payload: {} };
    expect(await store.insertEvent(row)).toBe(true);
    expect(await store.insertEvent(row)).toBe(false);
    const entry = { workflow: 'w', userId: 'u1', instanceId: 'i1', hash: 'h', ts: 1 };
    expect(await store.enterJourney(entry)).toBe('entered');
    expect(await store.enterJourney({ ...entry, instanceId: 'i2' })).toBeNull();
    await store.subscribe('i1', 'u1', ['x'], 1);
    await store.subscribe('i1', 'u1', ['x'], 2);
    expect(await store.findWakeHandles('u1', 'x')).toEqual(['i1']);
    await store.addSegmentMember('s', 'u1', 1, ['w']);
    await store.addSegmentMember('s', 'u1', 2, ['w']);
    expect(await store.isSegmentMember('s', 'u1')).toBe(true);
  });
});

describe('uuidv7', () => {
  test('is a version 7, variant 1 uuid ordered by time', () => {
    const a = uuidv7(1_000_000);
    const b = uuidv7(2_000_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('checkSchema', () => {
  test('a database migrated from the declared tables has no problems', async () => {
    const { store } = setup();
    expect(await store.checkSchema()).toEqual([]);
  });

  describe('a partially migrated database', () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await PGlite.create();
      await db.exec(`CREATE SCHEMA app;
        CREATE TABLE app.profile (user_id text NOT NULL, props text);`);
    }, 30_000);

    afterAll(async () => {
      await db.close();
    });

    test('lists what the live database lacks, without changing it', async () => {
      const store = new PostgresJourneyStore(client(db), { schema: 'app' });
      const problems = await store.checkSchema();
      expect(problems).toContain('table "app"."event" is missing');
      expect(problems).toContain('column "app"."profile"."props" is text, expected jsonb');
      expect(problems).toHaveLength(Object.keys(TABLES).length);
    });
  });

  describe('a database whose erasure table has no erased_at', () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await PGlite.create();
      const without = schemaSql.replace(/\n\s*"erased_at" timestamptz,?/, '');
      if (without === schemaSql) throw new Error('the DDL no longer declares erased_at');
      await db.exec(without);
    }, 30_000);

    afterAll(async () => {
      await db.close();
    });

    test('is refused: the tombstone has nowhere to record the erase', async () => {
      const store = new PostgresJourneyStore(client(db));
      expect(await store.checkSchema()).toEqual([
        'column "workflow"."erasure"."erased_at" is missing',
      ]);
    });
  });

  describe('a database missing a unique index', () => {
    let db: PGlite;
    const index = 'event_user_id_event_id_index';

    beforeAll(async () => {
      db = await PGlite.create();
      const withoutIndex = schemaSql.replace(
        new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${index}"[^\\n]*\\n`),
        ''
      );
      if (withoutIndex === schemaSql) throw new Error(`the DDL no longer declares ${index}`);
      await db.exec(withoutIndex);
    }, 30_000);

    afterAll(async () => {
      await db.close();
    });

    test('is refused by name: the ON CONFLICT target the first ingest would need', async () => {
      const store = new PostgresJourneyStore(client(db));
      expect(await store.checkSchema()).toEqual([`missing unique index "workflow"."${index}"`]);
    });
  });
});

describe('renderDrizzleSchema', () => {
  test('one file, every table on the configured schema', () => {
    const file = renderDrizzleSchema('marketing');
    expect(file).toContain("export const workflowSchema = pgSchema('marketing');");
    for (const spec of Object.values(TABLES)) {
      expect(file).toContain(`= workflowSchema.table(\n  '${spec.name}',`);
    }
    expect(file).not.toMatch(/defaultNow|default\(|gen_random_uuid/);
    expect(file).toContain(
      "check('event_uuid_v7', sql`substring(${table.id}::text, 15, 1) = '7'`)"
    );
    expect(renderDrizzleSchema('marketing')).toBe(file);
  });
});
