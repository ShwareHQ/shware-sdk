import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { postgresJsClient } from '../../src/postgres-js';
import { UserErasedError } from '../../src/store/index';
import { PostgresJourneyStore, type SqlClientLike } from '../../src/store/postgres';
import { TABLES, renderPostgresDdl } from '../../src/store/tables';

/**
 * The per-user mutual exclusion of the Postgres store (`lockUser`: `requestErasure`,
 * `forgetUser`, `enterJourney`, `admitInstance`), proved against a real Postgres over two
 * separate connections — PGlite runs one connection, so it can show the statements work but not
 * that two transactions order themselves. Every interleaving is driven by barriers the test
 * releases, never by sleeps; the one timer is the tick that observes a promise still pending.
 *
 *   WORKFLOW_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm exec vitest run tests/integration
 *
 * A plain `postgres:16` with default settings is enough. The run creates a schema of its own
 * (`workflow_t<random>`) and drops it at the end.
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
  const entry = (userId: string, instanceId: string) => ({
    workflow: 'w',
    userId,
    instanceId,
    hash: 'h',
    ts: 1,
    execution: { name: `n-${instanceId}`, target: 't', input: '{}' },
  });
  const rows = async (table: string) =>
    (await b.unsafe(`SELECT user_id FROM "${schema}"."${table}"`)).map((row) => row.user_id);

  beforeAll(async () => {
    const connect = () =>
      postgres(url as string, { max: 1, fetch_types: false, prepare: true, onnotice: () => {} });
    a = connect();
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
});
