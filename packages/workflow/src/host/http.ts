import * as z from 'zod/mini';
import type { Contract } from '../contract';
import { PREVIEW_MESSAGE_ID } from '../email';
import type { EmailRenderer } from '../email-sender';
import type { BundleIR, ScalarIR } from '../ir';
import { type TrackingOptions, handleTracking, recordPushOpen } from '../reporting/tracking';
import {
  type BundleVersion,
  type JourneyStore,
  SchemaMismatchError,
  UserErasedError,
  visitorSubject,
} from '../store/index';
import { TemplateValidationError } from '../templates';
import { type Authorize, authorized } from './auth';
import { identityError, ingestBatch, isNonEmptyString, isPlainObject, parseBatch } from './batch';
import { journeyMode } from './channels';
import {
  BundleIntegrityError,
  type SweepResult,
  deployBundle,
  forgetUser,
  getSubscriptions,
  getSubscriptionsByMessage,
  parseSubscriptionsPatch,
  registerDevice,
  removeDevice,
  setSubscriptions,
  setSubscriptionsByMessage,
  unbindDevice,
} from './ingest';
import type { JourneyEnv } from './platform';

/**
 * The HTTP surface, as one route table: the bare ingest API (`handleRequest`) and the routes
 * the full host adds (`serve` with its parts — the bundle, previews, tracking, the sweep). A
 * route whose part is absent answers 404, so the two share the table, the bearer check, the
 * body validation and the error mapping.
 */

/**
 * How the ingest API applies a contract: 'enforce' refuses an invalid event or
 * patch with a 400 before anything is stored, woken or started; 'report' logs
 * the issues (event id, name, field paths — never the payload) and accepts it,
 * for checking real producers before turning enforcement on.
 */
export interface IngestValidation {
  contract?: Contract | undefined;
  mode?: 'enforce' | 'report' | undefined;
}

/** What the full host serves beyond the ingest API. A route whose part is absent answers 404. */
export interface HostParts {
  /** The bundle compiled into the code: `GET /bundle` shows it, `POST /bundle/deploy` makes it live. */
  bundle?: (() => BundleIR) | undefined;
  /** The code version serving this request, recorded as live by `POST /bundle/deploy`. */
  bundleVersion?: BundleVersion | undefined;
  /** `GET /preview/:id?props=<JSON>`: the email templates, rendered. */
  preview?: { has(id: string): boolean; render: EmailRenderer } | undefined;
  /** `/t/*`, what recipients open (no bearer): served on a store that keeps reporting. */
  tracking?: TrackingOptions | undefined;
  /** `POST /segments/sweep`. */
  sweep?: (() => Promise<SweepResult>) | undefined;
}

export interface ServeContext {
  env: JourneyEnv;
  store: JourneyStore;
  validation?: IngestValidation | undefined;
  /**
   * The host's parts. Their presence is what makes this a deployed host rather than the bare
   * API: production then refuses to serve without `API_TOKEN` — unless the host authorizes
   * callers itself (`authorize`).
   */
  host?: HostParts | undefined;
  /** The host's own authorization for the API routes; the env's `API_TOKEN` bearer without one. */
  authorize?: Authorize<JourneyEnv> | undefined;
}

interface RouteContext {
  request: Request;
  url: URL;
  env: JourneyEnv;
  store: JourneyStore;
  validation: IngestValidation;
  host: HostParts;
}

interface Route {
  /** '*' takes every method (the tracking routes answer GET, HEAD and POST themselves). */
  method: 'GET' | 'POST' | 'PUT' | '*';
  path: string | RegExp | ((pathname: string) => boolean);
  /** `api`: the caller must be authorized (the host's `authorize`, or the bearer); `none`: public. */
  auth: 'none' | 'api';
  handle(ctx: RouteContext): Promise<Response>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const notFound = () => json({ error: 'not found' }, 404);

/* --------------------------------- bodies ---------------------------------- */

/** The request body is not JSON: the caller's to fix (a 400), not a server fault. */
class InvalidJsonError extends Error {
  override readonly name = 'InvalidJsonError';
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new InvalidJsonError('invalid JSON body', { cause: error });
  }
}

/**
 * Request bodies are untrusted JSON. They are read as unknown fields and
 * checked, never cast into the shape they are supposed to have: a cast only
 * silences the compiler, and what arrives here reaches SQL parameters.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  return isPlainObject(body) ? body : {};
}

/**
 * The topics the engine knows: the deployed bundle's list (compiled from the contract), or the
 * contract's when the bare API runs without a host — never the caller's.
 */
function declaredTopics(ctx: Pick<RouteContext, 'host' | 'validation'>): readonly string[] {
  return ctx.host.bundle?.().subscriptions?.topics ?? ctx.validation.contract?.topics ?? [];
}

const SUBSCRIPTIONS = /^\/subscriptions\/[^/]+$/;
const subscriptionsUser = (url: URL) =>
  decodeURIComponent(url.pathname.slice('/subscriptions/'.length));
/**
 * The same record, reached by one of the user's copies instead of their id: for the app's
 * preference page opened from an email's `preferencesUrl?m=<message>` without a sign-in. The
 * message id is the capability (an unguessable UUID, as `/t/u` trusts it); the bearer still
 * guards the route, so the page's own API proxies it, and rate-limits it as it sees fit.
 */
const SUBSCRIPTIONS_BY_MESSAGE = /^\/subscriptions\/by-message\/[^/]+$/;
const subscriptionsMessage = (url: URL) =>
  decodeURIComponent(url.pathname.slice('/subscriptions/by-message/'.length));

/* --------------------------------- routes ---------------------------------- */

const routes: readonly Route[] = [
  { method: 'GET', path: '/health', auth: 'none', handle: async () => json({ ok: true }) },
  {
    // Opened by recipients, so no bearer: the routes only record, and redirect to recorded URLs
    method: '*',
    path: /^\/t\//,
    auth: 'none',
    async handle({ request, store, host }) {
      if (host.tracking === undefined) return notFound();
      return (await handleTracking(request, store.reporting, host.tracking)) ?? notFound();
    },
  },
  {
    method: 'POST',
    path: '/ingest',
    auth: 'api',
    async handle({ request, env, store, validation }) {
      const parsed = parseBatch(await readJson(request), validation);
      if (!parsed.ok) {
        const { error, issues } = parsed;
        return json({ error, ...(issues === undefined ? {} : { issues }) }, 400);
      }
      return json(await ingestBatch(env, parsed.batch, store));
    },
  },
  {
    method: 'POST',
    path: '/devices',
    auth: 'api',
    async handle({ request, env, store }) {
      const { deviceId, userId, visitorId, token, platform } = await readBody(request);
      const refused = identityError(userId, visitorId);
      if (refused !== undefined) return json({ error: refused }, 400);
      if (deviceId !== undefined && !isNonEmptyString(deviceId)) {
        return json({ error: 'deviceId must be a non-empty string' }, 400);
      }
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
        return json({ error: "platform must be 'ios', 'android' or 'web'" }, 400);
      }
      const device = {
        deviceId,
        userId: userId as string | undefined,
        visitorId: visitorId as string | undefined,
        token,
        platform,
      };
      return json(await registerDevice(env, device, store));
    },
  },
  {
    method: 'POST',
    path: '/devices/unbind',
    auth: 'api',
    async handle({ request, env, store }) {
      const { token } = await readBody(request);
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      return json(await unbindDevice(env, token, store));
    },
  },
  {
    method: 'POST',
    path: '/devices/remove',
    auth: 'api',
    async handle({ request, env, store }) {
      const { token } = await readBody(request);
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      return json(await removeDevice(env, token, store));
    },
  },
  {
    method: 'POST',
    path: '/messages/opened',
    auth: 'api',
    async handle({ request, store }) {
      const { userId, messageId } = await readBody(request);
      if (!isNonEmptyString(userId)) return json({ error: 'userId required' }, 400);
      if (!isNonEmptyString(messageId)) return json({ error: 'messageId required' }, 400);
      const recorded = await recordPushOpen(store.reporting, userId, messageId);
      return json({ ok: true, recorded });
    },
  },
  {
    method: 'GET',
    path: SUBSCRIPTIONS,
    auth: 'api',
    async handle(ctx) {
      const userId = subscriptionsUser(ctx.url);
      if (userId === '') return json({ error: 'userId required' }, 400);
      return json(await getSubscriptions(ctx.store, userId, declaredTopics(ctx)));
    },
  },
  {
    method: 'PUT',
    path: SUBSCRIPTIONS,
    auth: 'api',
    async handle(ctx) {
      const userId = subscriptionsUser(ctx.url);
      if (userId === '') return json({ error: 'userId required' }, 400);
      const topics = declaredTopics(ctx);
      const parsed = parseSubscriptionsPatch(await readJson(ctx.request), topics);
      if (!parsed.ok) return json({ error: 'subscriptions refused', issues: parsed.issues }, 400);
      return json(await setSubscriptions(ctx.env, ctx.store, userId, parsed.patch, topics));
    },
  },
  {
    method: 'GET',
    path: SUBSCRIPTIONS_BY_MESSAGE,
    auth: 'api',
    async handle(ctx) {
      const messageId = subscriptionsMessage(ctx.url);
      const found = await getSubscriptionsByMessage(ctx.store, messageId, declaredTopics(ctx));
      return found === undefined ? json({ error: 'unknown message' }, 404) : json(found);
    },
  },
  {
    method: 'PUT',
    path: SUBSCRIPTIONS_BY_MESSAGE,
    auth: 'api',
    async handle(ctx) {
      const messageId = subscriptionsMessage(ctx.url);
      const topics = declaredTopics(ctx);
      const parsed = parseSubscriptionsPatch(await readJson(ctx.request), topics);
      if (!parsed.ok) return json({ error: 'subscriptions refused', issues: parsed.issues }, 400);
      const found = await setSubscriptionsByMessage(
        ctx.env,
        ctx.store,
        messageId,
        parsed.patch,
        topics
      );
      return found === undefined ? json({ error: 'unknown message' }, 404) : json(found);
    },
  },
  {
    method: 'POST',
    path: '/users/forget',
    auth: 'api',
    async handle({ request, env, store }) {
      const { userId, visitorId } = await readBody(request);
      if (isNonEmptyString(visitorId)) {
        return json(await forgetUser(env, visitorSubject(visitorId), store));
      }
      if (!isNonEmptyString(userId)) return json({ error: 'userId or visitorId required' }, 400);
      return json(await forgetUser(env, userId, store));
    },
  },
  {
    method: 'POST',
    path: '/deploy',
    auth: 'api',
    async handle({ request, env, store, host }) {
      // A host that carries its bundle deploys it by publishing a version (the new version applies
      // its own on its first request, `POST /bundle/deploy` re-applies it after a rollback): in
      // production a bundle posted by hand is never legitimate, only what a leaked bearer would
      // do with the routing table. The bare API, which carries none, has no other way to deploy.
      if (host.bundle !== undefined && journeyMode(env) === 'production') {
        return json(
          { error: 'deploy by publishing a version (POST /bundle/deploy applies its own bundle)' },
          409
        );
      }
      return json(await deployBundle(env, await readJson(request), store));
    },
  },
  {
    method: 'GET',
    path: '/bundle',
    auth: 'api',
    async handle({ host }) {
      return host.bundle === undefined ? notFound() : json(host.bundle());
    },
  },
  {
    method: 'POST',
    path: '/bundle/deploy',
    auth: 'api',
    async handle({ env, store, host }) {
      if (host.bundle === undefined) return notFound();
      // Forced, and recording the serving version: otherwise an older version still serving
      // during a rollout would put its routes live while the row kept naming the newer one —
      // which then never re-applies its own bundle
      return json(await deployBundle(env, host.bundle(), store, host.bundleVersion, true));
    },
  },
  {
    method: 'POST',
    path: '/segments/sweep',
    auth: 'api',
    async handle({ host }) {
      return host.sweep === undefined ? notFound() : json(await host.sweep());
    },
  },
  {
    method: 'GET',
    path: /^\/preview\//,
    auth: 'api',
    async handle({ url, host }) {
      const { preview } = host;
      if (preview === undefined) return notFound();
      const key = url.pathname.slice('/preview/'.length);
      if (!preview.has(key)) return json({ error: `unknown email template: ${key}` }, 404);
      // `?props=<JSON object>`: JSON keeps numbers and booleans typed, which query strings cannot
      let props: unknown;
      try {
        props = JSON.parse(url.searchParams.get('props') ?? '{}');
      } catch {
        return json({ error: 'props must be a JSON object' }, 400);
      }
      if (!isPlainObject(props)) return json({ error: 'props must be a JSON object' }, 400);
      // A preview is no copy, but it shows the footer a sent one has: the preferences link
      // renders with a placeholder message id
      const { subject, html } = await preview.render(key, props as Record<string, ScalarIR>, {
        messageId: PREVIEW_MESSAGE_ID,
      });
      // A header holds bytes, not text: a subject with a non-Latin-1 character would throw
      // here, so it travels percent-encoded (the reader `decodeURIComponent`s it)
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-subject': encodeURIComponent(subject),
        },
      });
    },
  },
];

function matches(path: Route['path'], pathname: string): boolean {
  if (typeof path === 'string') return path === pathname;
  if (path instanceof RegExp) return path.test(pathname);
  return path(pathname);
}

/**
 * Production without a bearer token (and no authorizer of the host's own) is not an open
 * instance, it is a mistake: anyone could ingest, identify and deploy. Only what recipients open
 * (`/t/*`) and the health check stay up.
 */
function refusesOpen(request: Request, ctx: ServeContext, pathname: string): boolean {
  return (
    ctx.authorize === undefined &&
    ctx.env.API_TOKEN === undefined &&
    journeyMode(ctx.env) === 'production' &&
    !pathname.startsWith('/t/') &&
    !(request.method === 'GET' && pathname === '/health')
  );
}

/**
 * Whether the caller may use an API route: the host's authorizer on a copy of the request (so a
 * body it verifies is still there for the route), or the env's `API_TOKEN` as a bearer. An
 * authorizer that throws is a failure, never an admission.
 */
async function allowed(request: Request, ctx: ServeContext): Promise<boolean> {
  if (ctx.authorize === undefined) return authorized(request, ctx.env);
  return ctx.authorize(request.clone(), ctx.env);
}

/**
 * What a failed request answers. Validation problems are the caller's to fix (a 400, saying
 * what); anything else stays out of the response body (internals are logged, not leaked).
 */
function failure(error: unknown): Response {
  if (error instanceof InvalidJsonError) return json({ error: 'invalid JSON body' }, 400);
  if (error instanceof z.core.$ZodError) {
    return json({ error: `invalid payload: ${error.message}` }, 400);
  }
  // The caller sent a self-inconsistent bundle: their problem to fix, so say what is wrong
  if (error instanceof BundleIntegrityError) return json({ error: error.message }, 400);
  // The query string is the props: a refusal is the caller's to fix, with the field paths
  if (error instanceof TemplateValidationError) {
    return json({ error: error.message, issues: error.issues }, 400);
  }
  // The user has an erasure tombstone: gone, and nothing about them is taken, now or later
  if (error instanceof UserErasedError) return json({ error: 'user is erased' }, 410);
  // The operator's to fix (run the migrations), so the response says what is missing
  if (error instanceof SchemaMismatchError) {
    return json({ error: error.message, problems: error.problems }, 503);
  }
  console.error('[workflow http]', error);
  return json({ error: 'internal error' }, 500);
}

/** One request through the table: the production gate, the bearer, the route, the error mapping. */
export async function serve(request: Request, ctx: ServeContext): Promise<Response> {
  const url = new URL(request.url);
  if (refusesOpen(request, ctx, url.pathname)) {
    return json(
      {
        error:
          'API_TOKEN is not set: production refuses to serve without it (set ENVIRONMENT=development to run open)',
      },
      503
    );
  }
  const candidates = routes.filter((route) => matches(route.path, url.pathname));
  if (candidates.length === 0) return notFound();
  // Every API route asks the authorizer; the health check and the recipients' routes never do.
  // An unset token and no authorizer means an open dev instance (see JourneyEnv.API_TOKEN);
  // production refuses to run that way
  if (candidates.some((route) => route.auth === 'api')) {
    let ok: boolean;
    try {
      ok = await allowed(request, ctx);
    } catch (error) {
      console.error('[workflow http] authorize failed', error);
      return json({ error: 'internal error' }, 500);
    }
    if (!ok) return json({ error: 'unauthorized' }, 401);
  }
  const route = candidates.find((r) => r.method === '*' || r.method === request.method);
  if (route === undefined) return json({ error: 'method not allowed' }, 405);
  try {
    return await route.handle({
      request,
      url,
      env: ctx.env,
      store: ctx.store,
      validation: ctx.validation ?? {},
      host: ctx.host ?? {},
    });
  } catch (error) {
    return failure(error);
  }
}

/** The bare ingest API over one store: `/health`, `/events`, `/identify`, `/devices*`, `/messages/opened`, `/subscriptions/:userId`, `/subscriptions/by-message/:messageId`, `/users/forget`, `/deploy`. */
export function handleRequest(
  request: Request,
  env: JourneyEnv,
  store: JourneyStore,
  validation: IngestValidation = {}
): Promise<Response> {
  return serve(request, { env, store, validation });
}
