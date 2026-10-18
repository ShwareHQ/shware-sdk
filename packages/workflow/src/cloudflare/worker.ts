import * as z from 'zod/mini';
import type * as core from 'zod/v4/core';
import { type JourneyConfig, compileConfig } from '../config';
import { type Contract, ContractValidationError, checkEvent } from '../contract';
import type { RegisteredAction } from '../engine/actions';
import type { JourneyObserver, MessageSender, MessageValidator } from '../engine/ports';
import { scaleSegmentWindows } from '../engine/time-scale';
import type { ScalarIR } from '../ir';
import { registryRenderer } from '../react-email';
import { reportingObserver } from '../reporting/observer';
import { handleTracking } from '../reporting/tracking';
import type { JourneyRuntimeOptions } from '../runtime';
import {
  type BundleVersion,
  type JourneyStore,
  SchemaMismatchError,
  type StoreLease,
} from '../store/index';
import { DEFAULT_SCHEMA } from '../store/tables';
import { TemplateValidationError, registryValidator } from '../templates';
import type { JourneyEnv, JourneyParams } from './bindings';
import { channelsFromConfig, runtimeFromConfig } from './channels';
import { d1Store } from './d1-env';
import {
  type SweepResult,
  deployBundle,
  handleRequest,
  ingestEvent,
  sweepSegments,
} from './router';
import { JourneyRunner } from './runner';

/** The fetch handler's execution context (the subset used). */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface JourneyWorkerOptions<Env extends JourneyEnv> {
  /**
   * The project's `workflow.config.ts` (`defineConfig`): what the Worker
   * deploys (`GET /bundle`, `POST /bundle/deploy` serve `compileConfig`), the
   * template registries the senders, the validator and `/preview` render from,
   * the contract every `/events` and `/identify` is checked against, the email
   * envelope, actions, and the runtime / APNs / FCM settings. Secrets come
   * from the env under the names `JourneyEnv` documents.
   */
  config: JourneyConfig;
  /**
   * The data plane, opened per request and per workflow run. Return a
   * `StoreLease` when the client must be released afterwards (a Postgres
   * connection); defaults to D1 + KV from the env's bindings. `database` is
   * the config's (`schema` defaulting to `workflow`), for a Postgres store:
   *
   *   store: (env, database) => postgresJsStore(env.HYPERDRIVE.connectionString, database)
   */
  store?: (env: Env, database: { schema: string }) => JourneyStore | StoreLease;
  /**
   * Reporting hooks: node arrivals, every copy sent (with the tracking it should carry — click
   * links and an open pixel for email, payload data for a push), and how each instance ended.
   * By default a store that keeps reporting (Postgres) records them itself, and the Worker
   * serves the email tracking routes (`/t/...`, on `WORKFLOW_ORIGIN`); override to report
   * elsewhere.
   */
  observer?: (env: Env, store: JourneyStore) => JourneyObserver;
  /** Message outlet override (tests, a custom gateway); by default the channels the config describes. */
  messages?: (env: Env, store: JourneyStore) => MessageSender;
  /** Per-instance runtime options override (a tester in fast-forward); by default `config.runtime` for `ENVIRONMENT`. */
  runtime?: (env: Env, params: JourneyParams) => JourneyRuntimeOptions;
  /**
   * The host's environment, as a zod schema over its vars and secrets (bindings pass through
   * untouched): checked the first time the Worker runs, so a missing or malformed variable fails
   * there — every problem listed — not at the send that needs it. Webhook templates read their
   * URL from the parsed values: `webhook: (env: Env) => env.WEBHOOK_DISCORD_ALERTS`.
   */
  env?: core.$ZodType<object>;
  /** 'enforce' (default) answers an event or patch the contract refuses with a 400; 'report' only logs it. */
  contractMode?: 'enforce' | 'report';
}

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
/** The Worker's environment failed its schema (`journeyWorker({ env })`). */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  constructor(readonly issues: readonly string[]) {
    super(`the Worker's environment is invalid:\n  ${issues.join('\n  ')}`);
  }
}

export function journeyWorker<Env extends JourneyEnv>(
  options: JourneyWorkerOptions<Env>
): JourneyWorker<Env> {
  const { config } = options;
  // Parsed once per env object: the runtime hands the same one to every request of an isolate
  const checked = new WeakMap<object, Env>();
  const checkEnv = (env: Env): Env => {
    if (options.env === undefined) return env;
    const cached = checked.get(env);
    if (cached !== undefined) return cached;
    const result = z.safeParse(options.env, env);
    if (!result.success) {
      // Names and reasons only: the values are secrets
      throw new EnvValidationError(
        result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      );
    }
    const merged: Env = { ...env, ...result.data };
    checked.set(env, merged);
    return merged;
  };
  const bundle = () => compileConfig(config);
  const emails = config.templates?.email;
  const database = { schema: config.database?.schema ?? DEFAULT_SCHEMA };
  // In fast-forward, segment windows scale with the journeys reading them (time-scale.ts)
  const lease = (env: Env): Required<StoreLease> => {
    const opened = options.store === undefined ? d1Store(env) : options.store(env, database);
    const noop = async () => {};
    const factor = runtimeFromConfig(config, env).timeScale;
    return 'store' in opened
      ? { store: scaleSegmentWindows(opened.store, factor), close: opened.close ?? noop }
      : { store: scaleSegmentWindows(opened, factor), close: noop };
  };

  class Runner extends JourneyRunner {
    private readonly leases = new WeakMap<JourneyStore, () => Promise<void>>();
    private current: JourneyStore | undefined;

    protected override createStore(): JourneyStore {
      // A run fails at its start on an invalid environment, not at the send that needs it
      const { store, close } = lease(checkEnv(this.env as Env));
      this.leases.set(store, close);
      this.current = store;
      return store;
    }

    protected override async closeStore(store: JourneyStore): Promise<void> {
      await this.leases.get(store)?.();
    }

    protected override contract(): Contract | undefined {
      return config.contract;
    }

    protected override createMessageValidator(): MessageValidator {
      return registryValidator(config.templates ?? {});
    }

    protected override createMessageSender(): MessageSender {
      if (this.current === undefined) return super.createMessageSender();
      if (options.messages !== undefined) {
        return options.messages(checkEnv(this.env as Env), this.current);
      }
      return channelsFromConfig(config, checkEnv(this.env as Env), { store: this.current });
    }

    protected override createObserver(store: JourneyStore): JourneyObserver | undefined {
      if (options.observer !== undefined) return options.observer(checkEnv(this.env as Env), store);
      return store.reporting === undefined
        ? undefined
        : reportingObserver(store.reporting, checkEnv(this.env as Env).WORKFLOW_ORIGIN);
    }

    protected override runtime(params: JourneyParams): JourneyRuntimeOptions {
      const env = checkEnv(this.env as Env);
      if (options.runtime !== undefined) return options.runtime(env, params);
      return runtimeFromConfig(config, env);
    }

    protected override actions(): readonly RegisteredAction[] {
      // An action ref is a registered action structurally: the same object carries name, code and hash
      return config.actions ?? [];
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

  const preview = emails === undefined ? undefined : registryRenderer(emails);

  // The bundle compiled into this version goes live on its own, once per isolate: the first
  // request or cron run reads which version's bundle is live (one row) and applies this one only
  // over an older version, so one still serving during a rollout can never put its routes back.
  // A failure (say the migrations have not run) is logged and retried a minute later. Only the
  // request that starts the check gets its promise back: a request context cannot wait on
  // another's I/O.
  let applying: Promise<void> | undefined;
  let retryAt = 0;
  const applyOwnBundle = (env: Env): Promise<void> | undefined => {
    const metadata = env.CF_VERSION_METADATA;
    if (metadata === undefined || metadata.id === '') return undefined;
    const version: BundleVersion = { id: metadata.id, createdAt: Date.parse(metadata.timestamp) };
    if (Number.isNaN(version.createdAt)) return undefined;
    if (applying !== undefined || Date.now() < retryAt) return undefined;
    applying = (async () => {
      const { store, close } = lease(env);
      try {
        if (store.liveBundleVersion === undefined) return; // D1: POST /bundle/deploy
        const live = await store.liveBundleVersion();
        if (live !== undefined && (live.id === version.id || live.createdAt >= version.createdAt))
          return;
        const result = await deployBundle(env, bundle(), store, version);
        if (result.applied) console.log(`[workflow] version ${version.id} is live`);
      } finally {
        await close();
      }
    })().catch((error: unknown) => {
      applying = undefined;
      retryAt = Date.now() + 60_000;
      console.error(`[workflow] could not make version ${version.id} live`, error);
    });
    return applying;
  };

  const fetch = async (request: Request, rawEnv: Env, ctx?: ExecutionContextLike) => {
    // Everything below reads the validated environment (the schema's defaults applied)
    let env: Env;
    try {
      env = checkEnv(rawEnv);
    } catch (error) {
      if (!(error instanceof EnvValidationError)) throw error;
      console.error(`[workflow] ${error.message}`);
      return json({ error: error.message }, 500);
    }
    const pending = applyOwnBundle(env);
    // In the background where the runtime has waitUntil; inline otherwise (tests)
    if (pending !== undefined) {
      if (ctx === undefined) await pending;
      else ctx.waitUntil(pending);
    }
    const url = new URL(request.url);
    const { store, close } = lease(env);
    try {
      // Opened by recipients, so no bearer: the routes only record, and redirect to recorded URLs
      if (url.pathname.startsWith('/t/') && store.reporting !== undefined) {
        const openedEvent = config.webPush?.openedEvent;
        const tracked = await handleTracking(request, store.reporting, {
          unsubscribe: config.emails?.unsubscribe,
          product: config.title,
          quickMs: config.emails?.tracking?.quickClickMs,
          pushOpened:
            openedEvent === undefined
              ? undefined
              : async ({ messageId, userId, at }) => {
                  const payload: Record<string, unknown> = { message_id: messageId };
                  const contract = config.contract;
                  const verdict =
                    contract === undefined ? undefined : checkEvent(contract, openedEvent, payload);
                  if (verdict !== undefined && !verdict.ok) {
                    throw new ContractValidationError(openedEvent, verdict.issues);
                  }
                  // Keyed by the copy: a second tap of the same notification is the same event
                  await ingestEvent(
                    env,
                    {
                      id: `${openedEvent}:${messageId}`,
                      userId,
                      event: openedEvent,
                      payload: verdict?.data ?? payload,
                      ts: at,
                    },
                    store
                  );
                },
        });
        if (tracked !== undefined) return tracked;
      }
      if (url.pathname === '/segments/sweep') {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        return json(await sweepSegments(env, store));
      }
      if (url.pathname === '/bundle') {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        return json(bundle());
      }
      if (url.pathname === '/bundle/deploy') {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        try {
          return json(await deployBundle(env, bundle(), store));
        } catch (error) {
          if (!(error instanceof SchemaMismatchError)) throw error;
          return json({ error: error.message, problems: error.problems }, 503);
        }
      }
      if (emails !== undefined && preview !== undefined && url.pathname.startsWith('/preview/')) {
        if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const key = url.pathname.slice('/preview/'.length);
        if (!Object.hasOwn(emails, key))
          return json({ error: `unknown email template: ${key}` }, 404);
        // `?props=<JSON object>`: JSON keeps numbers and booleans typed, which query strings cannot
        let props: unknown = {};
        try {
          props = JSON.parse(url.searchParams.get('props') ?? '{}');
        } catch {
          return json({ error: 'props must be a JSON object' }, 400);
        }
        if (typeof props !== 'object' || props === null || Array.isArray(props)) {
          return json({ error: 'props must be a JSON object' }, 400);
        }
        try {
          const { subject, html } = await preview(key, props as Record<string, ScalarIR>);
          return new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'x-subject': subject },
          });
        } catch (error) {
          // The query string is the props: a refusal is the caller's to fix, with the field paths
          if (error instanceof TemplateValidationError) {
            return json({ error: error.message, issues: error.issues }, 400);
          }
          throw error;
        }
      }
      return await handleRequest(request, env, store, {
        contract: config.contract,
        mode: options.contractMode,
      });
    } finally {
      // After the response when the runtime offers waitUntil, inline otherwise (tests).
      if (ctx === undefined) await close();
      else ctx.waitUntil(close());
    }
  };

  const sweep = async (rawEnv: Env) => {
    const env = checkEnv(rawEnv);
    const { store, close } = lease(env);
    try {
      return await sweepSegments(env, store);
    } finally {
      await close();
    }
  };

  const scheduled = async (_controller: unknown, env: Env, ctx: ExecutionContextLike) => {
    // A version with no traffic yet goes live here; the sweep then reads its segments
    ctx.waitUntil(
      (async () => {
        await applyOwnBundle(checkEnv(env));
        await sweep(env);
      })()
    );
  };

  return { Runner, fetch, sweep, scheduled };
}
