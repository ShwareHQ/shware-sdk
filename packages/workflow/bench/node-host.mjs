// A throughput measurement of the self-hosted runtime (`@shware/workflow/node`): the built
// package in Node containers of a set size, against a Postgres container of a set size, at
// several sizes of user base. Everything is on this machine's Docker — the journeys' actions
// are no-ops, no provider is configured, nothing is sent anywhere.
//
//   pnpm build && node bench/node-host.mjs
//
// It starts and removes its own containers (`wfbench-*`) and network, and prints two markdown
// tables. This process only generates load and reads counts; what is measured runs in the
// containers. BENCH_POPULATIONS (comma separated) and BENCH_SCALE (a factor on the batch sizes)
// shorten a trial run. BENCH_MODE=delay measures instead what an action that takes time does
// (a send to a provider: 200 ms, 1 s) at several settings of `concurrency`. BENCH_MODE=profile
// runs one batch under `pg_stat_statements` and prints where the database's time went.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { action, defineConfig, event, performed, trigger, workflow } from '../dist/index.mjs';
import { journeyNode } from '../dist/node/index.mjs';
import { postgresJsClient } from '../dist/postgres-js.mjs';
import { renderPostgresDdl } from '../dist/store/tables.mjs';

const SCHEMA = 'workflow_bench';
const NETWORK = 'wfbench';
const PG = { name: 'wfbench-pg', image: 'postgres:17', cpus: 2, memory: '4g', port: 54_329 };
const NODE = { image: 'node:26-slim', cpus: 1, memory: '1g', port: 55_400 };
const INSIDE_URL = `postgres://postgres:pw@${PG.name}:5432/postgres`;
const HOST_URL = `postgres://postgres:pw@127.0.0.1:${PG.port}/postgres`;
/** The seed user every other user of the population is a copy of. */
const SEED = 'seeduser';

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** How long each action takes: nothing, or the time of a call to a provider. */
const ACTION_MS = Number(process.env.BENCH_ACTION_MS ?? 0);
const noop = (name) =>
  action(name, async () => {
    if (ACTION_MS > 0) await sleep(ACTION_MS);
  });
const a = noop('a');
const b = noop('b');
const c = noop('c');
const e = event();
const once = { mode: 'never' };
const config = defineConfig({
  database: { schema: SCHEMA },
  workflows: [
    // One turn: three actions, start to end
    workflow({ id: 'steps', reentry: once, trigger: trigger.event(e.order) })
      .run(a)
      .run(b)
      .run(c),
    // Two turns: an action, a wait for an event, an action
    workflow({ id: 'wait', reentry: once, trigger: trigger.event(e.sign_up) })
      .run(a)
      .waitUntil(performed(e.login), { timeout: '1 hour' })
      .run(b),
    // What the population is in the middle of: an action done, asleep until tomorrow
    workflow({ id: 'nap', reentry: once, trigger: trigger.event(e.nap) })
      .run(a)
      .delay('1 day')
      .run(b),
  ],
  actions: [a, b, c],
  templates: {},
});

const host = (url, max, concurrency) => {
  const sql = postgres(url, { max, onnotice: () => {} });
  const client = postgresJsClient(sql);
  const journeys = journeyNode({
    config,
    sql: client,
    vars: { ENVIRONMENT: 'development' },
    concurrency,
  });
  return { sql, client, journeys };
};

if (process.env.BENCH_ROLE === 'worker') {
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 10);
  // A connection is held for a query, not for an action: many runs waiting on a provider share few
  const pool = concurrency <= 50 ? concurrency + 5 : 40;
  const { journeys } = host(process.env.BENCH_DATABASE_URL, pool, concurrency);
  await journeys.start({ port: 8787, hostname: '0.0.0.0' });
} else {
  await main();
}

async function main() {
  const docker = (...args) => execFileSync('docker', args, { stdio: 'pipe' }).toString().trim();
  const quiet = (...args) => {
    try {
      docker(...args);
    } catch {
      // Not there: nothing to remove
    }
  };
  const pause = sleep;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const here = fileURLToPath(new URL('../', import.meta.url));
  const scale = Number(process.env.BENCH_SCALE ?? 1);
  const populations = (process.env.BENCH_POPULATIONS ?? '0,10000,100000,1000000')
    .split(',')
    .map(Number);

  const cleanup = () => {
    const names = docker('ps', '-aq', '--filter', 'name=wfbench-').split('\n').filter(Boolean);
    if (names.length > 0) quiet('rm', '-f', ...names);
    quiet('network', 'rm', NETWORK);
  };
  cleanup();
  docker('network', 'create', NETWORK);
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    PG.name,
    '--network',
    NETWORK,
    '--cpus',
    String(PG.cpus),
    '--memory',
    PG.memory,
    '--shm-size',
    '1g',
    '-e',
    'POSTGRES_PASSWORD=pw',
    '-p',
    `127.0.0.1:${PG.port}:5432`,
    PG.image,
    '-c',
    'shared_buffers=1GB',
    '-c',
    'max_connections=300',
    ...(process.env.BENCH_MODE === 'profile'
      ? ['-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'pg_stat_statements.track=all']
      : [])
  );

  const { sql, client, journeys } = host(HOST_URL, 40, 10);
  for (let tries = 0; ; tries += 1) {
    try {
      await sql`SELECT 1`;
      // The image restarts the server once while it initialises
      await pause(3000);
      await sql`SELECT 1`;
      break;
    } catch (error) {
      if (tries > 60) throw error;
      await pause(1000);
    }
  }

  const run = `"${SCHEMA}"."run"`;
  const count = async (where) =>
    Number((await client.query(`SELECT count(*)::int AS n FROM ${run} WHERE ${where}`))[0].n);
  /** Runs that ended; counted over the index on `finished_at`, so the poll costs the database little. */
  const ended = () => count('finished_at IS NOT NULL');
  /** Runs parked on a wait with an hour's timeout: the population sleeps for a day, a queued run is due. */
  const parked = () =>
    count(`wake_at > now() + interval '20 minutes' AND wake_at < now() + interval '2 hours'`);
  const commits = async () =>
    Number(
      (
        await client.query(
          `SELECT xact_commit::text AS n FROM pg_stat_database WHERE datname = current_database()`
        )
      )[0].n
    );

  const post = (target, path, body) =>
    fetch(`${target}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** `total` events, one per user, forty requests at a time; events a second. */
  const ingest = async (name, prefix, total, send) => {
    const started = performance.now();
    let next = 0;
    await Promise.all(
      Array.from({ length: 40 }, async () => {
        for (let i = next++; i < total; i = next++) {
          const response = await send(i, { userId: `${prefix}${i}`, events: [{ event: name }] });
          if (response.status !== 200) throw new Error(`ingest: ${response.status}`);
        }
      })
    );
    return total / ((performance.now() - started) / 1000);
  };
  /** Straight into the database from this process: load that is not part of the measurement. */
  const direct = (_i, body) =>
    journeys.fetch(
      new Request('http://bench/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

  /** Node containers running the host; their HTTP addresses, and how to remove them. */
  const workers = async (processes, concurrency, actionMs = 0) => {
    const names = [];
    const targets = [];
    for (let i = 0; i < processes; i += 1) {
      const name = `wfbench-node-${i}`;
      docker(
        'run',
        '-d',
        '--rm',
        '--name',
        name,
        '--network',
        NETWORK,
        '--cpus',
        String(NODE.cpus),
        '--memory',
        NODE.memory,
        '-v',
        `${root}:${root}:ro`,
        '-w',
        here,
        '-e',
        'BENCH_ROLE=worker',
        '-e',
        `BENCH_DATABASE_URL=${INSIDE_URL}`,
        '-e',
        `BENCH_CONCURRENCY=${concurrency}`,
        '-e',
        `BENCH_ACTION_MS=${actionMs}`,
        '-p',
        `127.0.0.1:${NODE.port + i}:8787`,
        NODE.image,
        'node',
        'bench/node-host.mjs'
      );
      names.push(name);
      targets.push(`http://127.0.0.1:${NODE.port + i}`);
    }
    for (const target of targets) {
      for (let tries = 0; ; tries += 1) {
        try {
          await fetch(target);
          break;
        } catch (error) {
          if (tries > 100)
            throw new Error(`${docker('logs', names[0])}\n${String(error)}`, { cause: error });
          await pause(200);
        }
      }
    }
    return { targets, stop: () => docker('rm', '-f', ...names) };
  };

  /** CPU of the database and of the Node containers (their mean), sampled once; 100% is one core. */
  const cpu = () => {
    const lines = docker('stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}').split('\n');
    const of = (prefix) =>
      lines
        .filter((line) => line.startsWith(prefix))
        .map((line) => Number.parseFloat(line.split(' ')[1]));
    const node = of('wfbench-node-');
    const mean = node.reduce((sum, one) => sum + one, 0) / Math.max(1, node.length);
    return { pg: `${Math.round(of(PG.name)[0] ?? 0)}%`, node: `${Math.round(mean)}%` };
  };

  /** Poll until `read()` reaches `target`; when it first moved, when it arrived, and the CPUs midway. */
  const reach = async (read, from, target) => {
    let first;
    let seen;
    for (;;) {
      const now = await read();
      if (first === undefined && now > from) first = performance.now();
      if (seen === undefined && now - from > (target - from) / 3) seen = cpu();
      if (now >= target) return { first, last: performance.now(), cpu: seen ?? cpu() };
      await pause(200);
    }
  };

  const round = (n) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));
  const label = (n) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : `${n}`);
  const drains = [];
  const waits = [];
  const delays = [];
  let cell = 0;

  /** A batch already queued, taken to its end by fresh workers: runs a second while they work. */
  const drain = async (population, processes, concurrency, actionMs = 0) => {
    // With an action that takes time, the most the hosts can do is known: size the batch to
    // about half a minute of it
    const ceiling =
      actionMs === 0 ? undefined : (processes * concurrency) / ((3 * actionMs) / 1000);
    const total = Math.round(
      ceiling === undefined ? 10_000 * scale : Math.min(10_000, Math.max(300, ceiling * 30)) * scale
    );
    const base = await ended();
    await ingest('order', `d${(cell += 1)}x`, total, direct);
    const before = await commits();
    const { stop } = await workers(processes, concurrency, actionMs);
    const { first, last, cpu: used } = await reach(ended, base, base + total);
    stop();
    const failed = await count(`finished_at IS NOT NULL AND status <> 'complete'`);
    if (failed > 0) throw new Error(`${failed} runs did not complete`);
    const row = [
      label(population),
      `${processes} × ${NODE.cpus} vCPU`,
      concurrency,
      round(total / ((last - first) / 1000)),
      round(((await commits()) - before) / total),
      used.pg,
      used.node,
    ];
    if (ceiling !== undefined) {
      const rate = total / ((last - first) / 1000);
      delays.push([
        `${actionMs} ms`,
        concurrency,
        round(rate),
        round(rate * 3),
        round(ceiling),
        used.pg,
        used.node,
      ]);
      console.error(`delay  ${delays.at(-1).join('  ')}`);
      return;
    }
    drains.push(row);
    console.error(`drain  ${row.join('  ')}`);
  };

  /** In service: events over HTTP to the running hosts, each journey waiting for a second event. */
  const wait = async (population, processes, concurrency) => {
    const total = Math.round(5000 * scale);
    const prefix = `w${(cell += 1)}x`;
    const { targets, stop } = await workers(processes, concurrency);
    const http = (i, body) => post(targets[i % targets.length], '/ingest', body);
    const base = await ended();
    const started = performance.now();
    const accepted = await ingest('sign_up', prefix, total, http);
    const parking = await reach(parked, 0, total);
    const woken = performance.now();
    const wakes = await ingest('login', prefix, total, http);
    const ending = await reach(ended, base, base + total);
    stop();
    const row = [
      label(population),
      `${processes} × ${NODE.cpus} vCPU`,
      round(accepted),
      round(total / ((parking.last - started) / 1000)),
      round(wakes),
      round(total / ((ending.last - woken) / 1000)),
      ending.cpu.pg,
      ending.cpu.node,
    ];
    waits.push(row);
    console.error(`wait   ${row.join('  ')}`);
  };

  // The schema, the bundle, and the seed user: one journey run to its sleep, in this process
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql.unsafe(renderPostgresDdl(SCHEMA));
  const deployed = await journeys.fetch(
    new Request('http://bench/bundle/deploy', { method: 'POST' })
  );
  if (deployed.status !== 200) throw new Error(`deploy: ${deployed.status}`);
  await direct(0, { userId: SEED, events: [{ event: 'nap', id: `${SEED}-nap` }] });
  await journeys.drain();
  const tables = (
    await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1`, [SCHEMA])
  ).map((row) => String(row.tablename));

  /**
   * Grow the user base: every row about the seed user, in every table, copied once per new user
   * with the user's id (and so the instance's, which contains it) replaced. A user of the
   * population is one who signed up, has a profile and an event, and is asleep mid-journey.
   */
  let users = 0;
  const grow = async (target) => {
    const CHUNK = 50_000;
    for (let from = users + 1; from <= target; from += CHUNK) {
      const to = Math.min(target, from + CHUNK - 1);
      for (const name of tables) {
        const table = `"${SCHEMA}"."${name}"`;
        await sql.unsafe(
          `INSERT INTO ${table}
           SELECT n.* FROM ${table} r, generate_series(${from}, ${to}) AS i,
             LATERAL jsonb_populate_record(NULL::${table},
               replace(to_jsonb(r)::text, '${SEED}', 'p' || i)::jsonb) AS n
           WHERE to_jsonb(r)::text LIKE '%${SEED}%'
           ON CONFLICT DO NOTHING`
        );
      }
    }
    users = target;
    await sql.unsafe(`ANALYZE`);
    await sql.unsafe(`CHECKPOINT`);
  };

  const table = (head, rows) =>
    [head, head.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');

  if (process.env.BENCH_MODE === 'delay') {
    // Two hosts, a user base of 100k, three actions a journey, each taking this long
    await grow(Number(process.env.BENCH_POPULATIONS ?? 100_000));
    for (const actionMs of [200, 1000]) {
      for (const concurrency of [10, 50, 200]) await drain(users, 2, concurrency, actionMs);
    }
    console.log(
      table(
        [
          'Action takes',
          'Runs at once, each host',
          'Runs/s',
          'Actions/s',
          'Runs/s the setting allows',
          'Postgres CPU',
          'Host CPU',
        ],
        delays
      )
    );
    await sql.end({ timeout: 5 });
    cleanup();
    return;
  }

  if (process.env.BENCH_MODE === 'profile') {
    // One batch of the three-action journey, two hosts, a user base of 100k: every statement
    // the database ran for it, by the time it took
    await grow(Number(process.env.BENCH_POPULATIONS ?? 100_000));
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
    const total = Math.round(10_000 * scale);
    const base = await ended();
    await ingest('order', 'px', total, direct);
    await sql.unsafe(`SELECT pg_stat_statements_reset()`);
    const { stop } = await workers(2, 10);
    const { first, last } = await reach(ended, base, base + total);
    stop();
    const rows = await client.query(
      `SELECT regexp_replace(query, '\\s+', ' ', 'g') AS query, calls::float8 AS calls,
              total_exec_time::float8 AS ms, rows::float8 AS rows, wal_bytes::float8 AS wal
       FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       ORDER BY total_exec_time DESC`
    );
    const stats = rows.map((row) => ({
      query: String(row.query),
      calls: Number(row.calls),
      ms: Number(row.ms),
      wal: Number(row.wal),
    }));
    const all = stats.reduce((sum, row) => sum + row.ms, 0);
    const wal = stats.reduce((sum, row) => sum + row.wal, 0);
    console.log(
      `${total} runs in ${round((last - first) / 1000)} s; ${round(all / total)} ms of statement time and ` +
        `${round(wal / total / 1024)} kB of WAL a run; ${round(stats.reduce((sum, row) => sum + row.calls, 0) / total)} statements a run\n`
    );
    console.log(
      table(
        ['Share of time', 'Calls/run', 'Mean ms', 'WAL bytes/call', 'Statement'],
        stats
          .filter((row) => row.calls >= total / 10)
          .slice(0, 30)
          .map((row) => [
            `${round((row.ms / all) * 100)}%`,
            round(row.calls / total),
            (row.ms / row.calls).toFixed(3),
            Math.round(row.wal / row.calls),
            `\`${row.query.slice(0, 150).replaceAll('|', '\\|')}\``,
          ])
      )
    );
    await sql.end({ timeout: 5 });
    cleanup();
    return;
  }

  const sizes = [];
  for (const population of populations) {
    await grow(population);
    const [size] = await client.query(
      `SELECT (SELECT count(*)::int FROM ${run}) AS runs,
              pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS size
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [SCHEMA]
    );
    sizes.push([label(population), size.runs, size.size]);
    console.error(
      `population ${label(population)}: ${String(size.runs)} runs, ${String(size.size)}`
    );
    await drain(population, 2, 10);
    await wait(population, 2, 10);
    // How it scales with the hosts, at one size of user base
    if (population === 100_000 || populations.length === 1) {
      await drain(population, 1, 10);
      await drain(population, 4, 10);
      await drain(population, 2, 50);
      await wait(population, 4, 10);
    }
  }

  console.log(
    table(
      [
        'Users',
        'Hosts',
        'Runs at once, each',
        'Runs/s',
        'Transactions/run',
        'Postgres CPU',
        'Host CPU',
      ],
      drains
    )
  );
  console.log();
  console.log(
    table(
      [
        'Users',
        'Hosts',
        'Events/s accepted',
        'Runs/s to parked',
        'Wakes/s accepted',
        'Runs/s woken to end',
        'Postgres CPU',
        'Host CPU',
      ],
      waits
    )
  );
  console.log();
  console.log(table(['Users', 'Rows in `run`', 'Engine schema on disk'], sizes));

  await sql.end({ timeout: 5 });
  cleanup();
}
