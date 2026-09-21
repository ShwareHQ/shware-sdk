import type { RegisteredAction } from '../engine/actions';
import type { MessageSender } from '../engine/ports';
import type { BundleIR } from '../ir';
import type { JourneyRuntimeOptions } from '../runtime';
import type { JourneyStore, StoreLease } from '../store/index';
import type { JourneyEnv, JourneyParams } from './bindings';
import { d1Store } from './d1-env';
import { deployBundle, handleRequest } from './router';
import { JourneyRunner } from './runner';
import type { EmailRenderer } from './senders';

/** The fetch handler's execution context (the subset used). */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface JourneyWorkerOptions<Env extends JourneyEnv> {
  /**
   * The data plane, opened per request and per workflow run. Return a
   * `StoreLease` when the client must be released afterwards (a Postgres
   * connection); defaults to D1 + KV from the env's bindings.
   */
  store?: (env: Env) => JourneyStore | StoreLease;
  /** Message outlet, e.g. `new CfEmailSender({...})`; defaults to logging (or the webhook sender when MESSAGE_WEBHOOK_URL is set). */
  messages?: (env: Env, store: JourneyStore) => MessageSender;
  /**
   * The bundle this Worker deploys, compiled from its own code. Enables
   * `GET /bundle` (the IR) and `POST /bundle/deploy` (write it to the store) —
   * deploying becomes a call after `wrangler deploy`, not an upload.
   */
  bundle?: () => BundleIR;
  /** Per-instance runtime options (time scale, logging); see `resolveRuntime`. Defaults to real time, quiet. */
  runtime?: (env: Env, params: JourneyParams) => JourneyRuntimeOptions;
  /** Custom actions the workflows reference (`run(action, args)`). */
  actions?: readonly RegisteredAction[];
  /** Enables `GET /preview/<template>?prop=value` — the template rendered to HTML. Bearer-protected like everything else when API_TOKEN is set. */
  preview?: EmailRenderer;
}

export interface JourneyWorker<Env extends JourneyEnv> {
  /** Export this under the `class_name` of the wrangler `workflows` binding. */
  Runner: new (...args: never[]) => JourneyRunner;
  /** The Worker's fetch handler: `/health`, `/events`, `/identify`, `/deploy`, plus `/bundle`, `/bundle/deploy` and `/preview/*` when configured. */
  fetch: (request: Request, env: Env, ctx?: ExecutionContextLike) => Promise<Response>;
}

/**
 * A complete journey host in one call: the runner class with the app's store,
 * outlets and runtime plugged in, and the fetch handler that serves the ingest
 * API around them.
 *
 *   const journeys = journeyWorker<Env>({
 *     store: (env) => postgresJsStore(env.HYPERDRIVE.connectionString, { schema: 'application' }),
 *     messages: (env, store) => new CfEmailSender({ binding: env.EMAIL, from, render, profile: store }),
 *     runtime: (env) => resolveRuntime(config.runtime, env.ENVIRONMENT),
 *     bundle,
 *   });
 *   export const MyRunner = journeys.Runner;
 *   export default { fetch: journeys.fetch };
 */
export function journeyWorker<Env extends JourneyEnv>(
  options: JourneyWorkerOptions<Env>
): JourneyWorker<Env> {
  const lease = (env: Env): Required<StoreLease> => {
    const opened = options.store === undefined ? d1Store(env) : options.store(env);
    const noop = async () => {};
    return 'store' in opened
      ? { store: opened.store, close: opened.close ?? noop }
      : { store: opened, close: noop };
  };

  class Runner extends JourneyRunner {
    private readonly leases = new WeakMap<JourneyStore, () => Promise<void>>();
    private current: JourneyStore | undefined;

    protected override createStore(): JourneyStore {
      const { store, close } = lease(this.env as Env);
      this.leases.set(store, close);
      this.current = store;
      return store;
    }

    protected override async closeStore(store: JourneyStore): Promise<void> {
      await this.leases.get(store)?.();
    }

    protected override createMessageSender(): MessageSender {
      if (options.messages === undefined || this.current === undefined) {
        return super.createMessageSender();
      }
      return options.messages(this.env as Env, this.current);
    }

    protected override runtime(params: JourneyParams): JourneyRuntimeOptions {
      return options.runtime === undefined
        ? super.runtime(params)
        : options.runtime(this.env as Env, params);
    }

    protected override actions(): readonly RegisteredAction[] {
      return options.actions ?? [];
    }
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const authorized = (request: Request, env: Env): boolean =>
    env.API_TOKEN === undefined ||
    request.headers.get('authorization') === `Bearer ${env.API_TOKEN}`;

  const fetch = async (request: Request, env: Env, ctx?: ExecutionContextLike) => {
    const url = new URL(request.url);
    const { store, close } = lease(env);
    try {
      if (options.bundle !== undefined && url.pathname === '/bundle') {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        return json(options.bundle());
      }
      if (options.bundle !== undefined && url.pathname === '/bundle/deploy') {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        return json(await deployBundle(env, options.bundle(), store));
      }
      if (options.preview !== undefined && url.pathname.startsWith('/preview/')) {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const key = url.pathname.slice('/preview/'.length);
        const { subject, html } = await options.preview(key, Object.fromEntries(url.searchParams));
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'x-subject': subject },
        });
      }
      return await handleRequest(request, env, store);
    } finally {
      // After the response when the runtime offers waitUntil, inline otherwise (tests).
      if (ctx === undefined) await close();
      else ctx.waitUntil(close());
    }
  };

  return { Runner, fetch };
}
