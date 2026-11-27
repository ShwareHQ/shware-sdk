import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { JourneyParams } from '../../src/host/platform';
import { action, defineConfig, event, performed, trigger, workflow } from '../../src/index';
import { RunStore, journeyNode } from '../../src/node/index';
import { postgresJsClient } from '../../src/postgres-js';
import type { SqlClientLike } from '../../src/store/sql';
import { TABLES, renderPostgresDdl } from '../../src/store/tables';

/**
 * The self-hosted runtime (`@shware/workflow/node`) against a real Postgres, where its two
 * claims are actually contended: that a run is handed to one worker, and that a wake racing a
 * park is not lost. `tests/node-host.test.ts` shows the statements are right in order, on
 * PGlite's one connection; here they race over separate connections, and at the end over
 * separate processes, one of which is killed mid-step.
 *
 *   WORKFLOW_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm exec vitest run tests/integration
 *
 * The run creates a schema of its own (`workflow_n<random>`) and drops it at the end. The
 * process test runs the built package (`dist/`, by `pnpm build`) and is skipped, loudly, when
 * there is none. Nothing here is driven by barriers: the interleavings are whatever the server
 * makes of many connections at once, so the cases are sized to make the race likely, assert
 * what must hold under every ordering, and print how the orderings fell. Each was checked
 * against the fault it is for: without `FOR UPDATE SKIP LOCKED` the first fails, and with a
 * park that ignores the wake counter the second and third do.
 */

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
if (url === undefined || url === '') {
  process.stderr.write(
    '[integration] WORKFLOW_TEST_DATABASE_URL unset: the self-hosted runtime tests did not run\n'
  );
}
const worker = fileURLToPath(new URL('./fixtures/node-worker.mjs', import.meta.url));
const built = existsSync(fileURLToPath(new URL('../../dist/node/index.mjs', import.meta.url)));
if (url !== undefined && url !== '' && !built) {
  process.stderr.write('[integration] no dist/: the multi-process test did not run (pnpm build)\n');
}

const schema = `workflow_n${Math.random().toString(36).slice(2, 10)}`;
const pools: postgres.Sql[] = [];
/** Another pool: its connections are nobody else's. */
function pool(max: number, isolation?: 'repeatable read'): SqlClientLike {
  const sql = postgres(url ?? '', {
    max,
    onnotice: () => {},
    ...(isolation === undefined
      ? {}
      : { connection: { default_transaction_isolation: isolation } }),
  });
  pools.push(sql);
  return postgresJsClient(sql);
}

interface Events {
  sign_up: Record<string, never>;
  login: Record<string, never>;
}
const e = event<Events>();

let admin: SqlClientLike;
/** What an action did: one row per call, so a second call shows. */
const effect = (name: string) =>
  action(name, async (_args, ctx) => {
    await admin.query(`INSERT INTO "${schema}".effect (key, pid) VALUES ($1, $2)`, [
      ctx.idempotencyKey,
      process.pid,
    ]);
  });
const before = effect('before');
const after = effect('after');
const config = defineConfig({
  database: { schema },
  workflows: [
    workflow({ id: 'welcome', reentry: { mode: 'never' }, trigger: trigger.event(e.sign_up) })
      .run(before)
      .waitUntil(performed(e.login), { timeout: '1 hour' })
      .run(after),
  ],
  actions: [before, after],
  templates: {},
});

const params = (userId: string): JourneyParams =>
  ({ userId, trigger: { event: 'sign_up', ts: Date.now() } }) as unknown as JourneyParams;

const table = (name: keyof typeof TABLES) => `"${schema}"."${TABLES[name].name}"`;
const statuses = async () => {
  const rows = await admin.query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM ${table('run')} GROUP BY status`
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
};
/** Keys an action ran for more than once, and how many keys it ran for at all. */
const effects = async () => {
  const rows = await admin.query<{ key: string; n: number }>(
    `SELECT key, count(*)::int AS n FROM "${schema}".effect GROUP BY key`
  );
  return { keys: rows.length, repeated: rows.filter((row) => row.n > 1).length };
};
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
async function until(what: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await what())) {
    if (Date.now() > deadline) {
      // What a stuck run is stuck on: whether its wake was counted, and whether it is registered
      const [seen] = await admin.query(
        `SELECT (SELECT count(*)::int FROM ${table('subscription')}) AS subscriptions,
                (SELECT json_agg(DISTINCT signals) FROM ${table('run')}) AS signals`
      );
      throw new Error(`not reached: ${JSON.stringify(await statuses())} ${JSON.stringify(seen)}`);
    }
    await pause(100);
  }
}

/**
 * Send each user's `login` as soon as their run has begun its wait, and not before: the wait
 * counts only what happens after it began (its deadline step is the anchor). Sent the moment
 * that step shows, the wake lands while the same turn is still subscribing, checking and
 * parking — the window a lost wake would come from.
 */
async function loginOnceWaiting(
  users: number,
  send: (userId: string, n: number) => Promise<unknown>
): Promise<Record<string, number>> {
  /** Where each run stood when its login went out: `running` is a wake sent into a live turn. */
  const found: Record<string, number> = {};
  const sent = new Set<string>();
  const sending: Promise<unknown>[] = [];
  const deadline = Date.now() + 90_000;
  while (sent.size < users) {
    if (Date.now() > deadline) throw new Error(`only ${sent.size} of ${users} runs began to wait`);
    const rows = await admin.query<{ user_id: string; status: string }>(
      `SELECT r.params->>'userId' AS user_id, r.status FROM ${table('runStep')} s
       JOIN ${table('run')} r USING (instance_id) WHERE s.key = '1:deadline'`
    );
    for (const { user_id: userId, status } of rows) {
      if (sent.has(userId)) continue;
      sent.add(userId);
      found[status] = (found[status] ?? 0) + 1;
      sending.push(send(userId, sent.size));
    }
    await pause(2);
  }
  await Promise.all(sending);
  return found;
}

const post = (target: string, path: string, body?: unknown) =>
  fetch(`${target}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((listening) => {
    probe.listen(0, '127.0.0.1', listening);
  });
  const { port } = probe.address() as { port: number };
  await new Promise((closed) => {
    probe.close(closed);
  });
  return port;
}

describe.skipIf(url === undefined || url === '')('the self-hosted runtime on Postgres', () => {
  beforeAll(async () => {
    admin = pool(4);
    await admin.query(renderPostgresDdl(schema));
    await admin.query(`CREATE TABLE "${schema}".effect (key text NOT NULL, pid integer NOT NULL)`);
  }, 30_000);

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all(pools.map((sql) => sql.end({ timeout: 5 })));
  }, 30_000);

  beforeEach(async () => {
    const tables = Object.values(TABLES).map((one) => `"${schema}"."${one.name}"`);
    await admin.query(`TRUNCATE ${[...tables, `"${schema}".effect`].join(', ')}`);
  });

  test('many workers claiming at once: every run is handed out, and to one of them', async () => {
    const RUNS = 400;
    const seed = new RunStore(admin, schema);
    const now = Date.now();
    for (let i = 0; i < RUNS; i += 1) await seed.create(`r${i}`, params(`u${i}`), now, now);

    // Sixteen connections, half of them defaulting to REPEATABLE READ: the claim must not
    // depend on the pool's default
    const stores = Array.from(
      { length: 16 },
      (_, i) => new RunStore(pool(1, i % 2 === 0 ? undefined : 'repeatable read'), schema)
    );
    const claimed: string[] = [];
    let empty = 0;
    let failed = false;
    await Promise.all(
      stores.map(async (store, i) => {
        try {
          while (!failed) {
            const run = await store.claim(`w${i}`, Date.now(), 60_000);
            if (run !== undefined) claimed.push(run.instanceId);
            // An empty answer while runs remain is allowed; the end is not
            else if (claimed.length >= RUNS) return;
            else empty += 1;
          }
        } catch (error) {
          failed = true;
          throw error;
        }
      })
    );
    expect(claimed).toHaveLength(RUNS);
    expect(new Set(claimed).size).toBe(RUNS);
    expect(await statuses()).toEqual({ running: RUNS });
    process.stderr.write(`[integration] claim race: ${empty} empty answers while runs remained\n`);
  }, 60_000);

  test('a wake racing a park: whichever lands first, the run is due again', async () => {
    const RUNS = 300;
    const turnSide = new RunStore(pool(8), schema);
    const wakeSide = new RunStore(pool(8), schema);
    const now = Date.now();
    const DEADLINE = now + 3_600_000;
    for (let i = 0; i < RUNS; i += 1) await turnSide.create(`r${i}`, params(`u${i}`), now, now);
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await turnSide.claim('w', now, 60_000));

    await Promise.all(
      runs.flatMap((run) => {
        if (run === undefined) throw new Error('a run was not claimed');
        return [
          turnSide.suspend(run, { status: 'waiting', wakeAt: DEADLINE, ifSignals: 0 }, now),
          wakeSide.signal(run.instanceId, now),
        ];
      })
    );

    const rows = await admin.query<{ status: string; due: boolean; signals: number }>(
      `SELECT status, wake_at <= to_timestamp($1::double precision / 1000) AS due, signals
       FROM ${table('run')}`,
      [now]
    );
    // Parked then woken (`waiting`, due now) or woken then not parked (`queued`): never parked
    // until the deadline with the wake already counted
    expect(rows.filter((row) => !row.due)).toEqual([]);
    expect(rows.every((row) => row.signals === 1)).toBe(true);
    const order = { parkedFirst: 0, wokenFirst: 0 };
    for (const row of rows) order[row.status === 'waiting' ? 'parkedFirst' : 'wokenFirst'] += 1;
    process.stderr.write(`[integration] wake race: ${JSON.stringify(order)}\n`);
  }, 60_000);

  test('four hosts on their own pools: each step once, with the wake sent mid-turn', async () => {
    const USERS = 200;
    let sweeps = 0;
    /** Counts the sweep turns this client won. */
    const counting = (client: SqlClientLike): SqlClientLike => ({
      query: async <T>(text: string, values?: readonly unknown[]) => {
        const rows = await client.query<T>(text, values);
        if (text.includes(`VALUES ('sweep'`) && rows.length > 0) sweeps += 1;
        return rows;
      },
      transaction: (fn) => client.transaction(fn),
    });
    const hosts = Array.from({ length: 4 }, () =>
      journeyNode({
        config,
        sql: counting(pool(6)),
        vars: { ENVIRONMENT: 'development' },
        concurrency: 5,
        pollMs: 50,
      })
    );
    const call = (host: (typeof hosts)[number], path: string, body?: unknown) =>
      host.fetch(
        new Request(`http://node${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      );
    const [first] = hosts as [(typeof hosts)[number]];
    expect((await call(first, '/bundle/deploy')).status).toBe(200);
    await Promise.all(hosts.map((host) => host.start()));
    try {
      await Promise.all(
        Array.from({ length: USERS }, async (_, i) => {
          const host = hosts[i % hosts.length] ?? first;
          const response = await call(host, '/ingest', {
            userId: `u${i}`,
            events: [{ event: 'sign_up' }],
          });
          expect(response.status).toBe(200);
        })
      );
      // The login the journey waits for, through whichever host, while its turn is parking
      const found = await loginOnceWaiting(USERS, async (userId, n) => {
        const host = hosts[n % hosts.length] ?? first;
        const response = await call(host, '/ingest', { userId, events: [{ event: 'login' }] });
        expect(response.status).toBe(200);
      });
      process.stderr.write(`[integration] hosts: logins sent to runs ${JSON.stringify(found)}\n`);
      // The case this test is for did occur: wakes sent into turns still running
      expect(found.running).toBeGreaterThan(0);
      await until(async () => (await statuses()).complete === USERS, 60_000);
    } finally {
      await Promise.all(hosts.map((host) => host.stop()));
    }
    expect(await statuses()).toEqual({ complete: USERS });
    // Two actions a run, each exactly once
    expect(await effects()).toEqual({ keys: USERS * 2, repeated: 0 });
    // Four hosts started together: one of them took the sweep
    expect(sweeps).toBe(1);
  }, 120_000);

  test.skipIf(!built)(
    'three processes, one killed mid-step: every run still ends, and only its steps repeat',
    async () => {
      const USERS = 150;
      const CONCURRENCY = 4;
      const children: ChildProcess[] = [];
      const ports: number[] = [];
      const output: string[] = [];
      try {
        for (let i = 0; i < 3; i += 1) {
          const port = await freePort();
          ports.push(port);
          const child = spawn(process.execPath, [worker], {
            env: {
              ...process.env,
              WORKER_DATABASE_URL: url,
              WORKER_SCHEMA: schema,
              WORKER_PORT: String(port),
              WORKER_CONCURRENCY: String(CONCURRENCY),
              // A killed worker's runs are taken over after two seconds
              WORKER_LEASE_MS: '2000',
              // Long enough that a kill lands inside steps
              WORKER_STEP_MS: '250',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
          child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
          children.push(child);
        }
        await until(
          async () => output.filter((line) => line.includes('ready')).length === 3,
          20_000
        );
        const targets = ports.map((port) => `http://127.0.0.1:${port}`);
        const [a, b, c] = targets as [string, string, string];
        expect((await post(a, '/bundle/deploy')).status).toBe(200);

        // Over real HTTP, to the two processes that will live
        await Promise.all(
          Array.from({ length: USERS }, async (_, i) => {
            const target = i % 2 === 0 ? a : b;
            const response = await post(target, '/ingest', {
              userId: `u${i}`,
              events: [{ event: 'sign_up' }],
            });
            expect(response.status).toBe(200);
          })
        );
        const logins = loginOnceWaiting(USERS, async (userId, n) => {
          const response = await post(n % 2 === 0 ? a : b, '/ingest', {
            userId,
            events: [{ event: 'login' }],
          });
          expect(response.status).toBe(200);
        });
        // The third is in the middle of its steps: it dies without a word
        try {
          await until(async () => (await effects()).keys >= 30, 20_000);
          const victim = children[2];
          const killed = new Promise((exited) => {
            victim.once('exit', exited);
          });
          victim.kill('SIGKILL');
          await killed;
          await expect(post(c, '/health')).rejects.toThrow('fetch failed');
        } finally {
          await logins;
        }
        await until(async () => (await statuses()).complete === USERS, 90_000);

        expect(await statuses()).toEqual({ complete: USERS });
        const { keys, repeated } = await effects();
        expect(keys).toBe(USERS * 2);
        // At least once: a step the dead process had done but not checkpointed runs again, and
        // it held at most `CONCURRENCY` runs
        expect(repeated).toBeLessThanOrEqual(CONCURRENCY);
        process.stderr.write(
          `[integration] processes: ${repeated} steps ran twice after the kill\n`
        );
      } catch (error) {
        process.stderr.write(output.join(''));
        throw error;
      } finally {
        for (const child of children) child.kill('SIGKILL');
      }
    },
    180_000
  );
});
