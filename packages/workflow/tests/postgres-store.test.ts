import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { JourneyEnv } from '../src/cloudflare/bindings';
import { deployBundle, identifyUser, ingestEvent } from '../src/cloudflare/router';
import {
  compileBundle,
  eq,
  event,
  performed,
  segment,
  template,
  trigger,
  user,
  workflow,
} from '../src/index';
import { JourneyFactSource } from '../src/store/facts';
import { PostgresJourneyStore, type SqlClientLike, uuidv7 } from '../src/store/postgres';
import { FakeJourney } from './fake-cloudflare';

/**
 * PostgresJourneyStore against a real Postgres (PGlite, in-process) through
 * the same router the D1 store is tested with — the contract is the behaviour
 * the router relies on: atomic once-policy entries, idempotent subscriptions,
 * jsonb profile merges with null as "unset", timestamptz windows, and the
 * route swap.
 */

const schemaSql = readFileSync(
  new URL('../src/store/postgres-schema.sql', import.meta.url),
  'utf8'
);

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
  pg = new PGlite();
  await pg.exec(schemaSql);
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    'TRUNCATE workflow_event, workflow_profile, workflow_segment, workflow_trigger, workflow_segment_trigger, workflow_segment_member, workflow_entry, workflow_subscription, workflow_ir'
  );
});

interface Event {
  signed_up: Record<never, never>;
  purchase: { value: number };
}
interface UserProperty {
  userId: string;
  email: string;
  plan: string;
}
const e = event<Event>();
const u = user<UserProperty>();
const welcome = template.email('welcome');
const pro = segment('pro', eq(u.plan, 'pro'));
const purchased = segment('purchased', performed(e.purchase));

const welcomeFlow = workflow('welcome', { trigger: trigger.event(e.signed_up) }).email(welcome);
const proNudge = workflow('pro_nudge', { trigger: trigger.segment(pro), goal: purchased }).email(
  welcome
);
const bundle = () =>
  compileBundle({ workflows: [welcomeFlow, proNudge], segments: [pro, purchased] });

function setup() {
  const journey = new FakeJourney();
  const env: JourneyEnv = { JOURNEY: journey };
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
    expect(ir?.name).toBe('welcome');
    expect(await store.getWorkflowIR('nope')).toBeUndefined();
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
    const rows = await pg.query<{ event_id: string }>('SELECT event_id FROM workflow_event');
    expect(rows.rows).toEqual([{ event_id: 'evt-1' }]);
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

  test('a failed entry is reclaimed, a live one is not', async () => {
    const { store } = setup();
    const entry = { workflow: 'welcome', userId: 'u1', hash: 'h' };
    expect(await store.enterJourney({ ...entry, instanceId: 'i1', ts: 1 })).toBe('entered');
    expect(await store.enterJourney({ ...entry, instanceId: 'i2', ts: 2 })).toBeNull();
    await store.setEntryStatus('i1', 'failed');
    expect(await store.enterJourney({ ...entry, instanceId: 'i2', ts: 2 })).toBe('reclaimed');
    const rows = await pg.query<{ instance_id: string; status: string }>(
      'SELECT instance_id, status FROM workflow_entry'
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
      "SELECT jsonb_typeof(payload) AS t FROM workflow_event WHERE user_id = 'u1' LIMIT 1"
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
    expect(journey.created[0]?.params).toMatchObject({ workflowName: 'pro_nudge' });
    expect(await store.isSegmentMember('pro', 'u1')).toBe(true);

    const third = await identifyUser(env, 'u1', { plan: null }, store);
    expect(third.props).toEqual({ email: 'a@example.com' });
    expect(await facts.getProperty('plan')).toBeUndefined();
    expect(await store.isSegmentMember('pro', 'u1')).toBe(false);
  });
});

describe('subscriptions and entries', () => {
  test('subscribe is idempotent per (handle, event); unsubscribe drops the handle', async () => {
    const { env, store } = setup();
    await store.subscribe('inst-1', 'u1', ['purchase', 'signed_up'], 1);
    await store.subscribe('inst-1', 'u1', ['purchase'], 2);
    await store.subscribe('inst-2', 'u1', ['purchase'], 3);

    expect((await store.findWakeHandles('u1', 'purchase')).sort()).toEqual(['inst-1', 'inst-2']);
    expect(await store.findWakeHandles('u1', 'signed_up')).toEqual(['inst-1']);

    // Waking goes through the runtime; an unknown handle is dropped, a known one is woken.
    const journey = env.JOURNEY as FakeJourney;
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
    const rows = await pg.query<{ status: string }>('SELECT status FROM workflow_entry');
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

describe('uuidv7', () => {
  test('is a version 7, variant 1 uuid ordered by time', () => {
    const a = uuidv7(1_000_000);
    const b = uuidv7(2_000_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
