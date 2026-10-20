import * as z from 'zod/mini';
import type * as core from 'zod/v4/core';
import type { JourneyEnv, JourneyParams } from '../cloudflare/bindings';
import { d1Store } from '../cloudflare/d1-env';
import { type JourneyConfig, compileConfig } from '../config';
import { ContractValidationError, checkEvent } from '../contract';
import { assertEmailConfig } from '../email';
import type { EmailTransport } from '../email-sender';
import { RegistryActionInvoker } from '../engine/actions';
import type { JourneyObserver, MessageSender } from '../engine/ports';
import { scaleSegmentWindows } from '../engine/time-scale';
import type { BundleIR, NodeIR, ScalarIR } from '../ir';
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
import { TemplateValidationError, indexTemplates, registryValidator } from '../templates';
import { type Authorize, apiTokenBearer } from './authorize';
import { channelsFromConfig, runtimeFromConfig } from './channels';
import type { JourneyRunParts } from './execute';
import {
  type SweepResult,
  deployBundle,
  handleRequest,
  ingestEvent,
  sweepSegments,
} from './router';

/**
 * What a journey host is, apart from the runtime it runs on: the validated environment, the
 * store lease, the outlets a run is wired to, the HTTP API (tracking, sweep, bundle, preview,
 * ingest) and the bundle that goes live with the code. `journeyWorker` (Cloudflare) and
 * `journeyLambda` (AWS) are this plus how their platform starts, wakes and stops instances.
 */

export interface JourneyHostOptions<Env extends JourneyEnv> {
  /**
   * The project's `workflow.config.ts` (`defineConfig`): what the host
   * deploys (`GET /bundle`, `POST /bundle/deploy` serve `compileConfig`), the
   * template registries the senders, the validator and `/preview` render from,
   * the contract every `/events` and `/identify` is checked against, the email
   * defaults, actions, and the runtime / APNs / FCM settings. Secrets come
   * from the env under the names `JourneyEnv` documents.
   */
  config: JourneyConfig;
  /**
   * The data plane, opened per request and per workflow run. Return a
   * `StoreLease` when the client must be released afterwards (a Postgres
   * connection); defaults to D1 + KV from the env's bindings. `database` is
   * the config's (`schema` defaulting to `workflow`), for a Postgres store:
   *
   *   store: (env, database) => postgresJsStore(env.DATABASE_URL, database)
   */
  store?: (env: Env, database: { schema: string }) => JourneyStore | StoreLease;
  /**
   * Where journey emails go: a transport built from the validated env —
   * `sesEmailTransport(...)`, `cloudflareEmailTransport(...)`, or your own. Which one is
   * independent of where the workflow runs. Without it the email channel fails its sends,
   * saying so.
   */
  email?: (env: Env) => EmailTransport;
  /**
   * Reporting hooks: node arrivals, every copy sent (with the tracking it should carry — click
   * links and an open pixel for email, payload data for a push), and how each instance ended.
   * By default a store that keeps reporting (Postgres) records them itself, and the host
   * serves the email tracking routes (`/t/...`, on `WORKFLOW_ORIGIN`); override to report
   * elsewhere.
   */
  observer?: (env: Env, store: JourneyStore) => JourneyObserver;
  /**
   * Message outlet override (tests, a custom gateway): replaces every channel, `email`
   * included. By default the channels the config describes.
   */
  messages?: (env: Env, store: JourneyStore) => MessageSender;
  /** Per-instance runtime options override (a tester in fast-forward); by default `config.runtime` for `ENVIRONMENT`. */
  runtime?: (env: Env, params: JourneyParams) => JourneyRuntimeOptions;
  /**
   * The host's environment, as a zod schema over its vars and secrets (bindings pass through
   * untouched): checked the first time the host runs, so a missing or malformed variable fails
   * there — every problem listed — not at the send that needs it. Webhook templates read their
   * URL from the parsed values: `webhook: (env: Env) => env.WEBHOOK_DISCORD_ALERTS`.
   */
  env?: core.$ZodType<object>;
  /** 'enforce' (default) answers an event or patch the contract refuses with a 400; 'report' only logs it. */
  contractMode?: 'enforce' | 'report';
  /**
   * Who may call the protected routes, in whatever form the host chooses: a bearer, an HMAC over
   * the body, a JWT, a platform's identity. Receives a copy of the request; true lets it through,
   * false answers 401, a throw answers 500. The tracking routes and `/health` stay public. By
   * default, the env's `API_TOKEN` as a bearer (compared in constant time).
   *
   *   authorize: async (request, env) => verifyHmac(env.WEBHOOK_SECRET, request)
   */
  authorize?: Authorize<Env>;
}

/** The host's environment failed its schema (`env` option). */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  constructor(readonly issues: readonly string[]) {
    super(`the host's environment is invalid:\n  ${issues.join('\n  ')}`);
  }
}

export interface JourneyHost<Env extends JourneyEnv> {
  config: JourneyConfig;
  /** The env, parsed by the schema once per env object (throws EnvValidationError). */
  checkEnv(env: Env): Env;
  /** A store for one request or run, its segment windows scaled with the runtime. */
  lease(env: Env): Required<StoreLease>;
  /** The bundle compiled into this code. */
  bundle(): BundleIR;
  /** The outlets one run is wired to (the store is the run's). */
  runParts(env: Env, store: JourneyStore, params: JourneyParams): JourneyRunParts;
  /** The HTTP API over one store: tracking, sweep, bundle, preview, then the ingest router. */
  handle(request: Request, env: Env, store: JourneyStore): Promise<Response>;
  /** The scheduled sweep (`sweepSegments`) on a store of its own. */
  sweep(env: Env): Promise<SweepResult>;
  /**
   * Make the bundle compiled into `version` live, once per process, only over an older live
   * version (the store records it). Undefined when there is nothing to do; a failure is logged
   * and retried a minute later.
   */
  applyOwnBundle(env: Env, version: BundleVersion | undefined): Promise<void> | undefined;
}

/** What the platform adapter itself contributes. */
export interface JourneyPlatform {
  /** An HTTP/2 fetch for APNs, where the runtime's own fetch is HTTP/1.1 (Node). */
  apnsFetch?: typeof fetch;
}

function sendsEmail(nodes: readonly NodeIR[]): boolean {
  return nodes.some((node) => {
    switch (node.type) {
      case 'message':
        return node.channel === 'email';
      case 'wait_until':
        return Array.isArray(node.onTimeout) && sendsEmail(node.onTimeout);
      case 'branch':
        return (
          node.cases.some((branch) => sendsEmail(branch.flow)) || sendsEmail(node.otherwise ?? [])
        );
      case 'cohort':
        return node.arms.some((arm) => sendsEmail(arm.flow));
      default:
        return false;
    }
  });
}

export function createJourneyHost<Env extends JourneyEnv>(
  options: JourneyHostOptions<Env>,
  platform: JourneyPlatform = {}
): JourneyHost<Env> {
  const { config } = options;
  const emailIds = indexTemplates('email', config.templates?.email);
  // A config still on `emails` (its sender would be silently dropped) fails here, not at a send
  assertEmailConfig(config, emailIds.values());
  // A journey that emails with nowhere to send fails here too, not at its first email
  if (options.email === undefined && options.messages === undefined) {
    const emailing = compileConfig(config).workflows.filter((workflow) =>
      sendsEmail(workflow.flow)
    );
    if (emailing.length > 0) {
      throw new TypeError(
        `workflows ${emailing.map((w) => `'${w.id}'`).join(', ')} send email, but the host has no ` +
          '`email` transport: pass `email: (env) => cloudflareEmailTransport(...)` or `sesEmailTransport(...)`'
      );
    }
  }
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
  let compiled: BundleIR | undefined;
  const bundle = () => (compiled ??= compileConfig(config));
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

  const messages = (env: Env, store: JourneyStore): MessageSender => {
    if (options.messages !== undefined) return options.messages(env, store);
    return channelsFromConfig(config, env, {
      store,
      email: options.email?.(env),
      apnsFetch: platform.apnsFetch,
    });
  };

  const observer = (env: Env, store: JourneyStore): JourneyObserver | undefined => {
    if (options.observer !== undefined) return options.observer(env, store);
    return store.reporting === undefined
      ? undefined
      : reportingObserver(store.reporting, env.WORKFLOW_ORIGIN);
  };

  const runParts = (env: Env, store: JourneyStore, params: JourneyParams): JourneyRunParts => ({
    store,
    env,
    runtime:
      options.runtime === undefined ? runtimeFromConfig(config, env) : options.runtime(env, params),
    messages: messages(env, store),
    // An action ref is a registered action structurally: the same object carries name, code and hash
    actions: new RegistryActionInvoker(config.actions ?? []),
    contract: config.contract,
    validator: registryValidator(config.templates ?? {}),
    observer: observer(env, store),
  });

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const authorizer: Authorize<Env> = options.authorize ?? apiTokenBearer;
  /** The host's authorizer on a copy of the request (the route still reads the original). */
  const authorized = async (request: Request, env: Env): Promise<boolean> =>
    authorizer(request.clone(), env);

  const preview = emails === undefined ? undefined : registryRenderer(emails, config.email);

  const handle = async (request: Request, env: Env, store: JourneyStore): Promise<Response> => {
    const url = new URL(request.url);
    // Opened by recipients, so no bearer: the routes only record, and redirect to recorded URLs
    if (url.pathname.startsWith('/t/') && store.reporting !== undefined) {
      const openedEvent = config.webPush?.openedEvent;
      const tracked = await handleTracking(request, store.reporting, {
        legacyUnsubscribeUrl: config.email?.unsubscribeUrl,
        product: config.title,
        quickMs: config.email?.tracking?.quickClickMs,
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
      if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return json(await sweepSegments(env, store));
    }
    if (url.pathname === '/bundle') {
      if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return json(bundle());
    }
    if (url.pathname === '/bundle/deploy') {
      if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      try {
        return json(await deployBundle(env, bundle(), store));
      } catch (error) {
        if (!(error instanceof SchemaMismatchError)) throw error;
        return json({ error: error.message, problems: error.problems }, 503);
      }
    }
    if (emails !== undefined && preview !== undefined && url.pathname.startsWith('/preview/')) {
      if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      const key = url.pathname.slice('/preview/'.length);
      if (!emailIds.has(key)) return json({ error: `unknown email template: ${key}` }, 404);
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
    return handleRequest(request, env, store, {
      contract: config.contract,
      mode: options.contractMode,
      authorize: (copy) => authorizer(copy, env),
    });
  };

  const sweep = async (env: Env) => {
    const { store, close } = lease(env);
    try {
      return await sweepSegments(env, store);
    } finally {
      await close();
    }
  };

  // The bundle compiled into this version goes live on its own, once per process: the first
  // request or scheduled run reads which version's bundle is live (one row) and applies this one
  // only over an older version, so one still serving during a rollout can never put its routes
  // back. A failure (say the migrations have not run) is logged and retried a minute later. Only
  // the request that starts the check gets its promise back: a request context cannot wait on
  // another's I/O.
  let applying: Promise<void> | undefined;
  let retryAt = 0;
  const applyOwnBundle = (env: Env, version: BundleVersion | undefined) => {
    if (version === undefined || version.id === '' || Number.isNaN(version.createdAt)) {
      return undefined;
    }
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

  return { config, checkEnv, lease, bundle, runParts, handle, sweep, applyOwnBundle };
}
