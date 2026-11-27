import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { executeJourney } from '../host/execute';
import type { SweepResult } from '../host/ingest';
import { type JourneyHostOptions, createJourneyHost } from '../host/journey-host';
import type { JourneyEnv } from '../host/platform';
import { http2Fetch } from '../http2-client';
import { type BundleVersion, PostgresJourneyStore } from '../store/index';
import type { SqlClientLike } from '../store/sql';
import { DEFAULT_SCHEMA, TABLES } from '../store/tables';
import { RunStore } from './runs';
import { NodeRuntime, type StepRetryPolicy, type TurnResult } from './runtime';

/**
 * `@shware/workflow/node` — the journey host as a Node process on Postgres, with nothing else:
 * no Workflow binding, no durable-function service. The process is the runtime (`NodeRuntime`):
 * instances are rows, and workers in this process — and in every other process started the same
 * way — take them a turn at a time.
 *
 *   const journeys = journeyNode({
 *     config,
 *     sql: postgresJsClient(postgres(process.env.DATABASE_URL)),
 *     vars: { ENVIRONMENT: 'production', API_TOKEN: process.env.API_TOKEN },
 *     version: { id: process.env.GIT_SHA, createdAt: Date.parse(process.env.BUILD_TIME) },
 *   });
 *   await journeys.start({ port: 8787 });
 *
 * For tests and local runs the same thing works over PGlite with nothing started: `fetch` a
 * request, then `drain()` the runs it made due.
 */

export { NodeRuntime, DEFAULT_LEASE_MS, DEFAULT_STEP_RETRY } from './runtime';
export type { NodeRuntimeOptions, StepRetryPolicy, TurnParts, TurnResult } from './runtime';
export { RunStore } from './runs';
export type { ClaimedRun, RunStatus, StepRecord, Suspension } from './runs';

/** How long a run that ended is kept before the sweep removes it, as Cloudflare keeps its own. */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface JourneyNodeOptions<Env extends JourneyEnv> extends Omit<
  JourneyHostOptions<Env>,
  'store'
> {
  /**
   * The engine's database: a client that may be used by several things at once (a pool, or
   * PGlite). The host builds its stores over it and never closes it.
   */
  sql: SqlClientLike;
  /**
   * What the other hosts read from their platform's env — `ENVIRONMENT`, `API_TOKEN`, the
   * secrets — handed over by the process (`process.env`). Checked against the config's `env`
   * schema like theirs.
   */
  vars: Omit<Env, 'JOURNEY'>;
  /**
   * The version of this code: with it, the bundle compiled into the process goes live by itself,
   * and only over an older one — so two versions running side by side during a rollout cannot
   * take the routes back and forth. Without it, deploying is `POST /bundle/deploy`.
   */
  version?: BundleVersion;
  /** Runs taken at once by this process. */
  concurrency?: number;
  /** How often an idle worker looks for due runs when nothing told it one is. */
  pollMs?: number;
  /** How often the sweep runs (segments, date triggers, maintenance); one process does each. */
  sweepMs?: number;
  retentionMs?: number;
  leaseMs?: number;
  retry?: Partial<StepRetryPolicy>;
  now?: () => number;
}

export interface JourneyNode {
  runtime: NodeRuntime;
  /** The HTTP API, as a fetch handler: what `start({ port })` serves. */
  fetch(request: Request): Promise<Response>;
  /** Take every run that is due now a turn further; what each came to. */
  drain(limit?: number): Promise<TurnResult[]>;
  /** The sweep, now, whichever process ran it last. */
  sweep(): Promise<SweepResult>;
  /** Run: workers, the sweep timer, and an HTTP server when `port` is given. */
  start(options?: { port?: number; hostname?: string }): Promise<void>;
  /** Stop taking work, let the turns in flight reach their next checkpoint, close the server. */
  stop(): Promise<void>;
}

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_SWEEP_MS = 15 * 60_000;

export function journeyNode<Env extends JourneyEnv>(options: JourneyNodeOptions<Env>): JourneyNode {
  const { sql, version } = options;
  const now = options.now ?? (() => Date.now());
  const schema = options.config.database?.schema ?? DEFAULT_SCHEMA;
  const host = createJourneyHost<Env>(
    {
      ...options,
      // One client for everything: a lease has nothing of its own to close
      store: (_env, database) => new PostgresJourneyStore(sql, database),
    },
    // Node's own fetch speaks HTTP/1.1; APNs wants HTTP/2
    { apnsFetch: http2Fetch() }
  );

  /** The worker loops asleep until their next poll. A run that becomes due rouses one of them. */
  const idlers = new Set<() => void>();
  const rouse = () => {
    const one = idlers.values().next().value;
    one?.();
  };
  const runs = new RunStore(sql, schema);
  const runtime = new NodeRuntime({
    runs,
    now,
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    onDue: rouse,
    open: ({ instanceId, params, enteredAtMs }) => {
      const { store, close } = host.lease(env);
      return {
        store,
        close,
        execute: (step) =>
          executeJourney(
            { instanceId, params, enteredAtMs, step },
            host.runParts(env, store, params)
          ),
      };
    },
  });
  const env = host.checkEnv({ ...options.vars, JOURNEY: runtime.binding } as Env);

  const fetch = async (request: Request): Promise<Response> => {
    await host.applyOwnBundle(env, version);
    const { store, close } = host.lease(env);
    try {
      return await host.handle(request, env, store, version);
    } finally {
      await close();
    }
  };

  const sweep = async (): Promise<SweepResult> => {
    await host.applyOwnBundle(env, version);
    // A sweep stops after its budget and keeps its place in the store. A process has no limit
    // of its own to respect, so it carries on at once rather than an interval later — for as
    // long as an interval, and only while each round gets somewhere (a fan-out held up by a
    // failure is the next turn's to try again)
    const until = Date.now() + (options.sweepMs ?? DEFAULT_SWEEP_MS);
    const result = await host.sweep(env);
    let last = result;
    const open = (round: SweepResult) =>
      !round.finished || round.dates.some((date) => !date.finished);
    const moved = (round: SweepResult) =>
      round.evaluated > 0 ||
      round.started.length > 0 ||
      round.dates.some((date) => date.entered > 0);
    while (open(last) && moved(last) && !stopping && Date.now() < until) {
      last = await host.sweep(env);
      result.evaluated += last.evaluated;
      result.started.push(...last.started);
      result.sizes = last.sizes;
      result.finished = last.finished;
      result.dates.push(...last.dates);
    }
    await runtime.prune(options.retentionMs ?? DEFAULT_RETENTION_MS);
    return result;
  };

  /**
   * The sweep's turn among the processes: one row, claimed by whoever moves its time forward
   * first. No lock is held while the sweep runs — a process that dies in it costs one interval.
   */
  const deployment = `"${schema}"."${TABLES.deployment.name}"`;
  const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;
  const claimSweep = async (everyMs: number): Promise<boolean> => {
    const at = now();
    const rows = await sql.query(
      `INSERT INTO ${deployment} AS d (scope, version_id, version_created_at, applied_at)
       VALUES ('sweep', $1, ${TS('$2')}, ${TS('$2')})
       ON CONFLICT (scope) DO UPDATE SET version_id = EXCLUDED.version_id, applied_at = EXCLUDED.applied_at
       WHERE d.applied_at <= ${TS('$3')}
       RETURNING scope`,
      [version?.id ?? 'node', at, at - everyMs]
    );
    return rows.length > 0;
  };

  let stopping = false;
  let workers: Promise<void>[] = [];
  let sweeper: ReturnType<typeof setInterval> | undefined;
  let server: Server | undefined;

  /** Sleep until something is due, or the poll interval passes, whichever is first. */
  const idle = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        idlers.delete(done);
        resolve();
      }
      idlers.add(done);
    });

  const work = async (): Promise<void> => {
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    while (!stopping) {
      try {
        if ((await runtime.turn()) === undefined) await idle(pollMs);
      } catch (error) {
        // The database stumbled: the run keeps its lease until it expires, then is taken again
        console.error('[workflow node] a turn failed outside the journey', error);
        await idle(pollMs);
      }
    }
  };

  const start: JourneyNode['start'] = async ({ port, hostname } = {}) => {
    stopping = false;
    await host.applyOwnBundle(env, version);
    workers = Array.from({ length: options.concurrency ?? DEFAULT_CONCURRENCY }, work);
    const sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;
    const tick = () => {
      void claimSweep(sweepMs)
        .then((mine) => (mine ? sweep() : undefined))
        .catch((error: unknown) => {
          console.error('[workflow node] the sweep failed', error);
        });
    };
    // Checked several times an interval, so the process that takes over from a dead one is not
    // a whole interval late
    sweeper = setInterval(tick, Math.max(1_000, sweepMs / 4));
    tick();
    if (port !== undefined) {
      server = createServer((request, response) => {
        void serve(fetch, request, response);
      });
      await new Promise<void>((listening) => {
        server?.listen(port, hostname, listening);
      });
    }
  };

  const stop: JourneyNode['stop'] = async () => {
    stopping = true;
    clearInterval(sweeper);
    for (const one of Array.from(idlers)) one();
    if (server !== undefined) {
      await new Promise<void>((closed) => {
        server?.close(() => {
          closed();
        });
      });
      server = undefined;
    }
    // A turn in flight ends at its next checkpoint; one that does not is taken over by lease
    await Promise.all(workers);
    workers = [];
  };

  return { runtime, fetch, drain: (limit) => runtime.drain(limit), sweep, start, stop };
}

/** `node:http` in front of a fetch handler. */
async function serve(
  fetch: (request: Request) => Promise<Response>,
  incoming: IncomingMessage,
  outgoing: ServerResponse
): Promise<void> {
  try {
    const method = (incoming.method ?? 'GET').toUpperCase();
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Uint8Array);
    const body = Buffer.concat(chunks);
    const origin = `http://${incoming.headers.host ?? 'localhost'}`;
    const response = await fetch(
      new Request(new URL(incoming.url ?? '/', origin), {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' || body.length === 0 ? {} : { body }),
      })
    );
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => {
      outgoing.appendHeader(name, value);
    });
    outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[workflow node] request failed', error);
    if (!outgoing.headersSent) outgoing.statusCode = 500;
    outgoing.end();
  }
}
