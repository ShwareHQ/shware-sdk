import type { JourneyRunParts } from '../host/execute';
import {
  EnvValidationError,
  type JourneyHostOptions,
  createJourneyHost,
} from '../host/journey-host';
import type { SweepResult } from '../host/router';
import type { BundleVersion, JourneyStore } from '../store/index';
import type { JourneyEnv, JourneyParams } from './bindings';
import { JourneyRunner } from './runner';

export { EnvValidationError } from '../host/journey-host';

/** The fetch handler's execution context (the subset used). */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * `journeyWorker`'s options: the host's (config, store, email transport, observer, ...). The
 * email transport is the host's choice — `cloudflareEmailTransport({ binding: env.EMAIL })` for
 * Cloudflare Email, `sesEmailTransport(...)` for SES.
 */
export type JourneyWorkerOptions<Env extends JourneyEnv> = JourneyHostOptions<Env>;

export interface JourneyWorker<Env extends JourneyEnv> {
  /** Export this under the `class_name` of the wrangler `workflows` binding. */
  Runner: new (...args: never[]) => JourneyRunner;
  /** The Worker's fetch handler: `/health`, `/events`, `/identify`, `/devices`, `/messages/opened`, `/segments/sweep`, `/t/*` (email tracking), `/deploy`, `/bundle`, `/bundle/deploy` and `/preview/*`. */
  fetch: (request: Request, env: Env, ctx?: ExecutionContextLike) => Promise<Response>;
  /**
   * The segment sweep (`sweepSegments`): membership of every deployed segment for every known
   * user, the journeys of segments entered by the clock alone (`not(performed(e.login, { within:
   * '7 days' }))` has no event to ride on), and each segment's size. Also served as
   * `POST /segments/sweep`.
   */
  sweep: (env: Env) => Promise<SweepResult>;
  /** The cron trigger's handler: runs the sweep. Export it beside `fetch` with a `triggers.crons` entry. */
  scheduled: (controller: unknown, env: Env, ctx: ExecutionContextLike) => Promise<void>;
}

/**
 * A complete journey host in one call: the runner class with the app's store,
 * outlets and runtime plugged in, and the fetch handler that serves the ingest
 * API around them.
 *
 *   const journeys = journeyWorker<Env>({
 *     config,   // workflow.config.ts (defineConfig)
 *     store: (env, database) => postgresJsStore(env.HYPERDRIVE.connectionString, database),
 *   });
 *   export const MyRunner = journeys.Runner;
 *   export default { fetch: journeys.fetch };
 */
export function journeyWorker<Env extends JourneyEnv>(
  options: JourneyWorkerOptions<Env>
): JourneyWorker<Env> {
  const host = createJourneyHost(options);

  class Runner extends JourneyRunner {
    private readonly leases = new WeakMap<JourneyStore, () => Promise<void>>();

    protected override createStore(): JourneyStore {
      // A run fails at its start on an invalid environment, not at the send that needs it
      const { store, close } = host.lease(host.checkEnv(this.env as Env));
      this.leases.set(store, close);
      return store;
    }

    protected override async closeStore(store: JourneyStore): Promise<void> {
      await this.leases.get(store)?.();
    }

    protected override createRunParts(store: JourneyStore, params: JourneyParams): JourneyRunParts {
      return host.runParts(host.checkEnv(this.env as Env), store, params);
    }
  }

  /** CF's version metadata: the bundle compiled into each new version goes live by itself. */
  const ownVersion = (env: Env): BundleVersion | undefined => {
    const metadata = env.CF_VERSION_METADATA;
    if (metadata === undefined) return undefined;
    return { id: metadata.id, createdAt: Date.parse(metadata.timestamp) };
  };

  const fetch = async (request: Request, rawEnv: Env, ctx?: ExecutionContextLike) => {
    // Everything below reads the validated environment (the schema's defaults applied)
    let env: Env;
    try {
      env = host.checkEnv(rawEnv);
    } catch (error) {
      if (!(error instanceof EnvValidationError)) throw error;
      console.error(`[workflow] ${error.message}`);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const pending = host.applyOwnBundle(env, ownVersion(env));
    // In the background where the runtime has waitUntil; inline otherwise (tests)
    if (pending !== undefined) {
      if (ctx === undefined) await pending;
      else ctx.waitUntil(pending);
    }
    const { store, close } = host.lease(env);
    try {
      return await host.handle(request, env, store);
    } finally {
      // After the response when the runtime offers waitUntil, inline otherwise (tests).
      if (ctx === undefined) await close();
      else ctx.waitUntil(close());
    }
  };

  const sweep = (rawEnv: Env) => host.sweep(host.checkEnv(rawEnv));

  const scheduled = async (_controller: unknown, env: Env, ctx: ExecutionContextLike) => {
    // A version with no traffic yet goes live here; the sweep then reads its segments
    ctx.waitUntil(
      (async () => {
        const checked = host.checkEnv(env);
        await host.applyOwnBundle(checked, ownVersion(checked));
        await sweep(env);
      })()
    );
  };

  return { Runner, fetch, sweep, scheduled };
}
