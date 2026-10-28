import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { postgresJsClient } from '../../src/postgres-js';
import { type Engagement, type MessageRecord, UserErasedError } from '../../src/store/index';
import { PostgresJourneyStore, type SqlClientLike } from '../../src/store/postgres';
import { TABLES, renderPostgresDdl } from '../../src/store/tables';

/**
 * The per-user mutual exclusion of the Postgres store (user-lock.ts: every write about a user,
 * the entry and the admission, the reporting's instance and message rows, and the erasure's
 * two steps), proved against a real Postgres over two separate connections — PGlite runs one
 * connection, so it can show the statements work but not that two transactions order
 * themselves. Every interleaving is driven by barriers the test releases, never by sleeps; the
 * one timer is the tick that observes a promise still pending.
 *
 *   WORKFLOW_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm exec vitest run tests/integration
 *
 * A plain `postgres:17` with default settings is enough. The run creates a schema of its own
 * (`workflow_t<random>`) and drops it at the end. Connection A defaults to REPEATABLE READ,
 * the setting under which a transaction waiting for the lock would otherwise keep a snapshot
 * from before it: the store pins each of its transactions to READ COMMITTED, and the
 * erase-first cases below are what shows it.
 *
 * While a transaction on one connection waits for the lock, that connection is busy: nothing
 * else goes to its store (or its raw client) until the gate holding it is released.
 */

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
if (url === undefined || url === '') {
  // Straight to stderr: vitest's default reporter shows a file's console output only when one of
  // its tests ran, and here every test is skipped — the warning must not be skipped with them
  process.stderr.write(
    '[integration] WORKFLOW_TEST_DATABASE_URL unset: the Postgres lock tests did not run\n'
  );
}

/** How long a promise is watched before it counts as still pending. */
const TICK_MS = 250;

/** `'pending'` when the promise has not settled within a tick; it settles either way later. */
async function after(promise: Promise<unknown>): Promise<'pending' | 'settled'> {
  const settled = promise.then(
    () => 'settled' as const,
    () => 'settled' as const
  );
  const tick = new Promise<'pending'>((resolve) => {
    setTimeout(() => resolve('pending'), TICK_MS);
  });
  return Promise.race([settled, tick]);
}

/**
 * A pause inside a store transaction: `arrived` resolves when the transaction's work is done
 * and it is waiting to commit, `release` lets it commit (`fail` makes it roll back instead).
 */
class Barrier {
  readonly arrived: Promise<void>;
  private arrive!: () => void;
  private readonly gate: Promise<void>;
  release!: () => void;
  fail!: (error: Error) => void;

  constructor() {
    this.arrived = new Promise((resolve) => {
      this.arrive = resolve;
    });
    this.gate = new Promise((resolve, reject) => {
      this.release = resolve;
      this.fail = reject;
    });
  }

  /** Wraps a client so each transaction's callback pauses here after its work, before it returns. */
  wrap(base: SqlClientLike): SqlClientLike {
    return {
      query: (text, params) => base.query(text, params),
      transaction: (fn) =>
        base.transaction(async (tx) => {
          const result = await fn(tx);
          this.arrive();
          await this.gate;
          return result;
        }),
    };
  }
}

const person = (at: number): Engagement => ({
  at,
  machine: false,
  reason: null,
  userAgent: null,
  asn: null,
  organization: null,
  country: null,
});

const copy = (userId: string, key: string): MessageRecord => ({
  idempotencyKey: key,
  workflow: 'w',
  instanceId: `i-${key}`,
  nodeId: 'n1',
  template: 'welcome',
  channel: 'email',
  topic: null,
  userId,
  sentAt: 1,
});

/**
 * One write about a user, parameterising the write-first / erase-first cases: what it writes
 * (`tables`, to find the rows and see them gone) and how it answers a tombstone (`refused`:
 * `UserErasedError`; otherwise a silent no-op, the reporting's observations).
 */
interface Write {
  name: string;
  tables: string[];
  refused: boolean;
  run: (store: PostgresJourneyStore, userId: string) => Promise<unknown>;
}

const WRITES: Write[] = [
  {
    name: 'mergeProfile',
    tables: ['profile'],
    refused: true,
    run: (store, userId) => store.mergeProfile(userId, { plan: 'pro' }),
  },
  {
    name: 'insertEvent',
    tables: ['event'],
    refused: true,
    run: (store, userId) => store.insertEvent({ id: 'e1', userId, event: 'x', ts: 1, payload: {} }),
  },
  {
    name: 'upsertDevice',
    tables: ['device'],
    refused: true,
    run: (store, userId) =>
      store.upsertDevice({ token: `t-${userId}`, userId, platform: 'ios', ts: 1 }),
  },
  {
    name: 'addSegmentMember',
    tables: ['segment_member', 'segment_start'],
    refused: true,
    run: (store, userId) => store.addSegmentMember('s', userId, 1, ['w']),
  },
  {
    name: 'subscribe',
    tables: ['subscription'],
    refused: true,
    run: (store, userId) => store.subscribe(`h-${userId}`, userId, ['x', 'y'], 1),
  },
  {
    name: 'reporting.instanceStarted',
    tables: ['instance'],
    refused: false,
    run: (store, userId) =>
      store.reporting.instanceStarted({ workflow: 'w', instanceId: `i-${userId}`, userId, at: 1 }),
  },
  {
    name: 'reporting.recordMessage',
    tables: ['message'],
    refused: true,
    run: (store, userId) => store.reporting.recordMessage(copy(userId, `k-${userId}`)),
  },
];

/** How a write about a tombstoned user ended: refused by the tombstone, or a no-op that resolved. */
async function verdict(write: Promise<unknown>): Promise<'refused' | 'ok'> {
  try {
    await write;
    return 'ok';
  } catch (error) {
    if (error instanceof UserErasedError) return 'refused';
    throw error;
  }
}

describe.skipIf(url === undefined || url === '')('Postgres user locks over two connections', () => {
  const schema = `workflow_t${Math.random().toString(16).slice(2, 10)}`;
  let a: postgres.Sql;
  let b: postgres.Sql;
  let storeA: PostgresJourneyStore;
  let storeB: PostgresJourneyStore;
  const barriers: Barrier[] = [];

  const barrier = () => {
    const created = new Barrier();
    barriers.push(created);
    return created;
  };
  /** A store on connection A whose transactions pause at the barrier before committing. */
  const gatedA = (gate: Barrier) =>
    new PostgresJourneyStore(gate.wrap(postgresJsClient(a)), { schema });
  /** The same on connection B. */
  const gatedB = (gate: Barrier) =>
    new PostgresJourneyStore(gate.wrap(postgresJsClient(b)), { schema });
  const entry = (userId: string, instanceId: string) => ({
    workflow: 'w',
    userId,
    instanceId,
    hash: 'h',
    ts: 1,
    execution: { name: `n-${instanceId}`, target: 't', input: '{}' },
  });
  // Both read on connection B: only once no gate holds a transaction there
  const rows = async (table: string) =>
    (await b.unsafe(`SELECT user_id FROM "${schema}"."${table}"`)).map((row) => row.user_id);
  const count = async (table: string) =>
    Number((await b.unsafe(`SELECT count(*)::int AS c FROM "${schema}"."${table}"`))[0]?.c);

  beforeAll(async () => {
    const connect = (connection: Record<string, string> = {}) =>
      postgres(url as string, {
        max: 1,
        fetch_types: false,
        prepare: true,
        onnotice: () => {},
        connection,
      });
    // A is the writer in the erase-first cases: under REPEATABLE READ by default, so a
    // transaction the store failed to pin would read the state from before its wait
    a = connect({ default_transaction_isolation: 'repeatable read' });
    b = connect();
    await a.unsafe(renderPostgresDdl(schema));
    storeA = new PostgresJourneyStore(postgresJsClient(a), { schema });
    storeB = new PostgresJourneyStore(postgresJsClient(b), { schema });
  }, 30_000);

  afterAll(async () => {
    await a.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
  });

  beforeEach(async () => {
    await a.unsafe(
      `TRUNCATE ${Object.values(TABLES)
        .map((t) => `"${schema}"."${t.name}"`)
        .join(', ')}`
    );
  });

  afterEach(() => {
    // A barrier a failed assertion left closed would hold connection A's transaction forever
    for (const gate of barriers.splice(0)) gate.release();
  });

  test('an entry committing late is found by the erasure, which waits for it', async () => {
    const gate = barrier();
    const entered = gatedA(gate).enterJourney(entry('u1', 'i1'));
    await gate.arrived;
    // A's entry and execution are written, not committed; B's erasure must wait for the lock.
    // (Nothing else goes to B meanwhile: its one connection is the one waiting.)
    const erasure = storeB.requestErasure('u1', 5);
    expect(await after(erasure)).toBe('pending');

    gate.release();
    expect(await entered).toBe('entered');
    await erasure;
    // Committed before the tombstone: the erasure sees the entry (never admitted) and erases it
    expect(await storeB.runningInstances('u1')).toEqual([{ instanceId: 'i1', admitted: false }]);
    expect(await storeB.erasureState('u1')).toBe('erasing');
    await storeB.forgetUser('u1', 6);
    expect(await rows('entry')).toEqual([]);
    expect(await rows('execution')).toEqual([]);
    expect(await storeB.erasureState('u1')).toBe('erased');
  });

  test('an entry after the tombstone is refused, nothing written', async () => {
    await storeB.requestErasure('u1', 5);
    await expect(storeA.enterJourney(entry('u1', 'i1'))).rejects.toBeInstanceOf(UserErasedError);
    expect(await rows('entry')).toEqual([]);
    expect(await rows('execution')).toEqual([]);
    await storeB.forgetUser('u1', 6);
    await expect(storeA.enterJourney(entry('u1', 'i2'))).rejects.toBeInstanceOf(UserErasedError);
    expect(await rows('entry')).toEqual([]);
  });

  test('admission before the tombstone is seen by the erasure; after it, refused', async () => {
    // Admission first
    expect(await storeA.enterJourney(entry('u1', 'i1'))).toBe('entered');
    expect(await storeA.admitInstance('i1', 'u1')).toBe(true);
    await storeB.requestErasure('u1', 5);
    expect(await storeB.runningInstances('u1')).toEqual([{ instanceId: 'i1', admitted: true }]);

    // Erasure first
    expect(await storeA.enterJourney(entry('u2', 'i2'))).toBe('entered');
    await storeB.requestErasure('u2', 5);
    expect(await storeA.admitInstance('i2', 'u2')).toBe(false);
    expect(await storeB.runningInstances('u2')).toEqual([{ instanceId: 'i2', admitted: false }]);

    // An admission paused before its commit holds the erasure back the same way
    const gate = barrier();
    expect(await storeA.enterJourney(entry('u3', 'i3'))).toBe('entered');
    const admitted = gatedA(gate).admitInstance('i3', 'u3');
    await gate.arrived;
    const erasure = storeB.requestErasure('u3', 5);
    expect(await after(erasure)).toBe('pending');
    gate.release();
    expect(await admitted).toBe(true);
    await erasure;
    expect(await storeB.runningInstances('u3')).toEqual([{ instanceId: 'i3', admitted: true }]);
  });

  test('a rollback releases the lock: the erasure completes and nothing half-entered stays', async () => {
    const gate = barrier();
    const entered = gatedA(gate).enterJourney(entry('u1', 'i1'));
    await gate.arrived;
    const erasure = storeB.requestErasure('u1', 5);
    expect(await after(erasure)).toBe('pending');

    gate.fail(new Error('boom'));
    await expect(entered).rejects.toThrow('boom');
    await erasure;
    expect(await rows('entry')).toEqual([]);
    expect(await rows('execution')).toEqual([]);
    expect(await storeB.erasureState('u1')).toBe('erasing');
    // The connection is usable again, and the tombstone now refuses the entry
    await expect(storeA.enterJourney(entry('u1', 'i1'))).rejects.toBeInstanceOf(UserErasedError);
  });

  test("one user's lock does not hold another user's writes", async () => {
    const gate = barrier();
    const entered = gatedA(gate).enterJourney(entry('u1', 'i1'));
    await gate.arrived;

    expect(await storeB.enterJourney(entry('u2', 'i2'))).toBe('entered');
    expect(await storeB.admitInstance('i2', 'u2')).toBe(true);
    await storeB.requestErasure('u2', 5);
    await storeB.forgetUser('u2', 6);
    expect(await storeB.erasureState('u2')).toBe('erased');
    // u1's lock is still held: its erasure still waits
    const erasure = storeB.requestErasure('u1', 7);
    expect(await after(erasure)).toBe('pending');

    gate.release();
    expect(await entered).toBe('entered');
    await erasure;
    expect(await rows('entry')).toEqual(['u1']);
  });

  describe.each(WRITES)('$name', (write) => {
    test('written first: the erasure waits for it, then takes it — no second pass', async () => {
      const gate = barrier();
      // A's rows are written past their conditional, not committed; the lock is A's
      const written = write.run(gatedA(gate), 'u1');
      await gate.arrived;
      const erasure = storeB.requestErasure('u1', 5);
      expect(await after(erasure)).toBe('pending');

      gate.release();
      await written;
      await erasure;
      // Committed before the tombstone, so the erasure sees every row of the write
      for (const table of write.tables) expect(new Set(await rows(table))).toEqual(new Set(['u1']));
      await storeB.forgetUser('u1', 6);
      for (const table of write.tables) expect(await rows(table)).toEqual([]);
      expect(await storeB.erasureState('u1')).toBe('erased');
    });

    test('erased first: the write waits for the lock, reads the tombstone, writes nothing', async () => {
      const gate = barrier();
      // B's tombstone is written, not committed; the lock is B's
      const erasure = gatedB(gate).requestErasure('u1', 5);
      await gate.arrived;
      const written = write.run(storeA, 'u1');
      expect(await after(written)).toBe('pending');

      gate.release();
      await erasure;
      // The snapshot is taken after the wait, under READ COMMITTED: the tombstone is seen
      expect(await verdict(written)).toBe(write.refused ? 'refused' : 'ok');
      for (const table of write.tables) expect(await rows(table)).toEqual([]);
      // And the same once the erase went through
      await storeB.forgetUser('u1', 6);
      expect(await verdict(write.run(storeA, 'u1'))).toBe(write.refused ? 'refused' : 'ok');
      for (const table of write.tables) expect(await rows(table)).toEqual([]);
    });
  });

  test('a subscription of several events is one transaction: refused whole, nothing half-written', async () => {
    const gate = barrier();
    const erasure = gatedB(gate).requestErasure('u1', 5);
    await gate.arrived;
    const subscribed = storeA.subscribe('h', 'u1', ['x', 'y', 'z'], 1);
    expect(await after(subscribed)).toBe('pending');
    gate.release();
    await erasure;
    await expect(subscribed).rejects.toBeInstanceOf(UserErasedError);
    expect(await count('subscription')).toBe(0);
  });

  test("a copy's child rows and the erasure: the user lock first, then the copy — no orphan, no revival", async () => {
    // Child write first: its links are in, uncommitted, under u1's lock; the erasure waits
    const id = await storeA.reporting.recordMessage(copy('u1', 'k1'));
    const gate = barrier();
    const linked = gatedA(gate).reporting.recordLinks(id, ['https://example.com/a']);
    await gate.arrived;
    const erasure = storeB.requestErasure('u1', 5);
    expect(await after(erasure)).toBe('pending');
    gate.release();
    await linked;
    await erasure;
    expect(await count('message_link')).toBe(1);
    await storeB.forgetUser('u1', 6);
    // The copy went with its children: nothing left under a copy that is gone
    expect(await count('message')).toBe(0);
    expect(await count('message_link')).toBe(0);

    // Erase first: the copy is visible when the child write looks its owner up, deleted (not
    // committed) by the erasure holding the lock; after the wait the re-check finds it gone
    const other = await storeA.reporting.recordMessage(copy('u2', 'k2'));
    await storeA.reporting.recordLinks(other, ['https://example.com/b']);
    await storeB.requestErasure('u2', 7);
    const forgetGate = barrier();
    const forgotten = gatedB(forgetGate).forgetUser('u2', 8);
    await forgetGate.arrived;
    const opened = storeA.reporting.recordOpen(other, () => person(9));
    expect(await after(opened)).toBe('pending');
    forgetGate.release();
    await forgotten;
    expect(await opened).toBe(false);
    // The same for the other child paths, now that the copy is gone
    await storeA.reporting.recordLinks(other, ['https://example.com/c']);
    expect(
      await storeA.reporting.recordClick(other, 0, 9, 1_000, () => ({
        engagement: person(9),
        backdate: false,
      }))
    ).toBeUndefined();
    expect(await storeA.reporting.recordDeviceDelivered(other, 9)).toBe(false);
    expect(await storeA.reporting.recordUnsubscribe(other, 9)).toBeUndefined();
    for (const table of ['message', 'message_link', 'message_open', 'message_click']) {
      expect(await count(table)).toBe(0);
    }
    expect(await storeB.erasureState('u2')).toBe('erased');
  });

  test("a held lock on u1 does not hold u2's plain writes or reporting", async () => {
    const gate = barrier();
    const merged = gatedA(gate).mergeProfile('u1', { plan: 'pro' });
    await gate.arrived;

    expect(await storeB.mergeProfile('u2', { plan: 'free' })).toEqual({ plan: 'free' });
    expect(
      await storeB.insertEvent({ id: 'e', userId: 'u2', event: 'x', ts: 1, payload: {} })
    ).toBe(true);
    await storeB.subscribe('h2', 'u2', ['x'], 1);
    await storeB.addSegmentMember('s', 'u2', 1, ['w']);
    await storeB.reporting.instanceStarted({
      workflow: 'w',
      instanceId: 'i2',
      userId: 'u2',
      at: 1,
    });
    const id = await storeB.reporting.recordMessage(copy('u2', 'k2'));
    await storeB.reporting.recordLinks(id, ['https://example.com/a']);
    expect(await storeB.reporting.recordOpen(id, () => person(2))).toBe(true);
    // u1's lock is still held: a write of u1 on B waits
    const erasure = storeB.requestErasure('u1', 7);
    expect(await after(erasure)).toBe('pending');

    gate.release();
    expect(await merged).toEqual({ plan: 'pro' });
    await erasure;
    expect((await rows('profile')).sort((a, b) => a.localeCompare(b))).toEqual(['u1', 'u2']);
  });

  test('after forgetUser the tables are empty at once, and a repeat is idempotent', async () => {
    await storeA.mergeProfile('u1', { plan: 'pro' });
    await storeA.insertEvent({ id: 'e', userId: 'u1', event: 'x', ts: 1, payload: {} });
    await storeA.upsertDevice({ token: 't', userId: 'u1', platform: 'ios', ts: 1 });
    await storeA.subscribe('h', 'u1', ['x'], 1);
    await storeA.addSegmentMember('s', 'u1', 1, ['w']);
    expect(await storeA.enterJourney(entry('u1', 'i1'))).toBe('entered');
    expect(await storeA.admitInstance('i1', 'u1')).toBe(true);
    await storeA.reporting.instanceStarted({
      workflow: 'w',
      instanceId: 'i1',
      userId: 'u1',
      at: 1,
    });
    const id = await storeA.reporting.recordMessage(copy('u1', 'k1'));
    await storeA.reporting.recordLinks(id, ['https://example.com/a']);
    expect(await storeA.reporting.recordOpen(id, () => person(2))).toBe(true);
    expect(await storeA.reporting.recordUnsubscribe(id, 3)).toEqual({ userId: 'u1' });
    const userTables = [
      'profile',
      'event',
      'device',
      'subscription',
      'segment_member',
      'segment_start',
      'entry',
      'execution',
      'instance',
      'message',
    ];
    for (const table of userTables) expect(await rows(table)).toEqual(['u1']);

    await storeB.requestErasure('u1', 5);
    await storeB.forgetUser('u1', 6);
    for (const table of [...userTables, 'message_link', 'message_open']) {
      expect(await count(table)).toBe(0);
    }
    // The opt-out outlives the erasure; the tombstone keeps the first erase's time
    expect(await storeB.isSuppressed('u1', 'email')).toBe(true);
    const erasedAt = async () =>
      (
        await b.unsafe(
          `SELECT (extract(epoch FROM erased_at) * 1000)::bigint::text AS at FROM "${schema}"."erasure" WHERE user_id = 'u1'`
        )
      )[0]?.at;
    expect(await erasedAt()).toBe('6');
    await storeB.forgetUser('u1', 9);
    await storeB.requestErasure('u1', 10);
    expect(await erasedAt()).toBe('6');
    expect(await storeB.erasureState('u1')).toBe('erased');
    // Nothing of theirs can land after it
    await expect(storeA.mergeProfile('u1', { plan: 'pro' })).rejects.toBeInstanceOf(
      UserErasedError
    );
    await expect(storeA.reporting.recordMessage(copy('u1', 'k3'))).rejects.toBeInstanceOf(
      UserErasedError
    );
    for (const table of userTables) expect(await count(table)).toBe(0);
  });
});
