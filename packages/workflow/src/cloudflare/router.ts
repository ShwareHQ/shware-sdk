import * as z from 'zod/mini';
import { murmur3 } from '../engine/bucket';
import { PROFILE_UPDATED_EVENT, evaluateCondition, matchesWhere } from '../engine/condition';
import { BundleIR, type TriggerIR } from '../ir';
import { JourneyFactSource } from '../store/facts';
import type { JourneyStore, ProfileProps } from '../store/index';
import {
  type JourneyEnv,
  type JourneyParams,
  WAKE_EVENT_TYPE,
  type WorkflowInstanceLike,
} from './bindings';
import { d1Store } from './d1-env';

/**
 * Ingest router. An incoming event does four things: it is stored, it wakes
 * waiting instances, it is matched against event triggers, and it re-evaluates
 * segment-trigger membership. Plus /deploy (persist a bundle) and /identify
 * (merge a profile — which wakes property-condition waits via
 * PROFILE_UPDATED_EVENT and re-evaluates segment triggers too).
 *
 * Storage goes through a JourneyStore; the `store` argument defaults to the
 * D1 + KV store built from the env's bindings, so a Worker that only has those
 * calls these functions exactly as before.
 */

export interface IngestInput {
  userId: string;
  event: string;
  payload?: Record<string, unknown>;
  ts?: number;
}

export interface IngestResult {
  stored: true;
  woke: number;
  started: string[];
}

export async function ingestEvent(
  env: JourneyEnv,
  input: IngestInput,
  store: JourneyStore = d1Store(env)
): Promise<IngestResult> {
  if (input.event.startsWith('$')) {
    throw new Error(`event name '${input.event}' is reserved ('$' prefix is internal)`);
  }
  const ts = input.ts ?? Date.now();
  const payload = input.payload ?? {};

  await store.insertEvent({ userId: input.userId, event: input.event, ts, payload });

  const woke = await wakeSubscribers(env, store, input.userId, input.event);
  const started = await startTriggeredJourneys(env, store, { ...input, payload }, ts);
  started.push(...(await refreshSegmentTriggers(env, store, input.userId, ts)));
  return { stored: true, woke, started };
}

async function wakeSubscribers(
  env: JourneyEnv,
  store: JourneyStore,
  userId: string,
  event: string
): Promise<number> {
  let woke = 0;
  for (const handle of await store.findWakeHandles(userId, event)) {
    let instance: WorkflowInstanceLike;
    try {
      instance = await env.JOURNEY.get(handle);
    } catch {
      // Unknown instance (errored out without cleanup): drop the dangling subscription
      await store.unsubscribe(handle);
      continue;
    }
    try {
      await instance.sendEvent({ type: WAKE_EVENT_TYPE, payload: { event } });
      woke++;
    } catch {
      // Transient send failure (or an instance finishing right now): keep the
      // subscription — a later event retries it, and the wait's own timeout
      // bounds the damage. Deleting here would silence all future wake-ups.
    }
  }
  return woke;
}

async function startTriggeredJourneys(
  env: JourneyEnv,
  store: JourneyStore,
  input: IngestInput & { payload: Record<string, unknown> },
  ts: number
): Promise<string[]> {
  const started: string[] = [];
  for (const route of await store.findTriggers(input.event)) {
    // where: the payload gate — evaluated against the incoming event first
    if (route.where !== null && !matchesWhere(input.payload, route.where)) continue;

    // filter: the profile gate
    if (route.filter !== null) {
      const facts = new JourneyFactSource(store, input.userId);
      if (!(await evaluateCondition(route.filter, facts, ts))) continue;
    }

    const instanceId = await startJourney(
      env,
      store,
      route.workflow,
      route.hash,
      input.userId,
      ts,
      {
        event: input.event,
        payload: input.payload,
      }
    );
    if (instanceId !== null) started.push(instanceId);
  }
  return started;
}

/**
 * Segment-entry triggers, maintained lazily: on each ingest/identify for a
 * user, re-evaluate every trigger-routed segment for that user and act on the
 * membership transition (enter → start journeys, leave → drop membership so a
 * later re-entry is observable). Purely time-driven drift (an inactivity
 * segment turning true by clock alone) is only seen on the user's next
 * activity — TODO: a cron sweep for time-driven segments.
 */
async function refreshSegmentTriggers(
  env: JourneyEnv,
  store: JourneyStore,
  userId: string,
  ts: number
): Promise<string[]> {
  const routes = await store.listSegmentTriggers();
  if (routes.length === 0) return [];

  const facts = new JourneyFactSource(store, userId);
  const bySegment = new Map<string, { workflow: string; hash: string }[]>();
  for (const route of routes) {
    const list = bySegment.get(route.segment) ?? [];
    list.push({ workflow: route.workflow, hash: route.hash });
    bySegment.set(route.segment, list);
  }

  const started: string[] = [];
  for (const [segmentName, segmentRoutes] of bySegment) {
    const definition = await store.getSegmentCondition(segmentName);
    if (definition === undefined) continue; // route without a definition: broken deploy, skip

    const matches = await evaluateCondition(definition, facts, ts);
    const member = await store.isSegmentMember(segmentName, userId);

    if (matches && !member) {
      // Entry transition: record membership, then start the routed workflows
      await store.addSegmentMember(segmentName, userId, ts);
      for (const route of segmentRoutes) {
        const instanceId = await startJourney(env, store, route.workflow, route.hash, userId, ts, {
          event: '$segment_entry',
          payload: { segment: segmentName },
        });
        if (instanceId !== null) started.push(instanceId);
      }
    } else if (!matches && member) {
      await store.removeSegmentMember(segmentName, userId);
    }
  }
  return started;
}

/**
 * Create one journey instance behind the entry ledger. Returns null when the
 * once-policy blocks the entry (the store's insert is atomic, so concurrent
 * ingests cannot double-enter).
 */
async function startJourney(
  env: JourneyEnv,
  store: JourneyStore,
  workflow: string,
  hash: string,
  userId: string,
  ts: number,
  trigger: { event: string; payload: Record<string, unknown> }
): Promise<string | null> {
  const instanceId = buildInstanceId(workflow, hash, userId, ts);
  const params: JourneyParams = { workflowName: workflow, contentHash: hash, userId, trigger };

  const entered = await store.enterJourney({ workflow, userId, instanceId, hash, ts });
  if (!entered) return null; // already entered

  try {
    await env.JOURNEY.create({ id: instanceId, params });
  } catch (error) {
    // Roll the ledger back so a retried ingest can enter — otherwise the
    // once-policy would permanently record an entry that never ran.
    await store.removeEntry(instanceId);
    throw error;
  }
  return instanceId;
}

const utf8 = new TextEncoder();

/**
 * Instance id: addressable (the router gets it directly to wake it), ≤100
 * chars, legal charset. The murmur3 fingerprint keeps ids distinct when the
 * sanitized/truncated userId alone would collide.
 */
function buildInstanceId(workflow: string, hash: string, userId: string, ts: number): string {
  const uid = userId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24);
  const fingerprint = murmur3(utf8.encode(userId)).toString(36);
  return `${workflow.slice(0, 32)}-${hash.slice(0, 8)}-${uid}-${fingerprint}-${ts.toString(36)}`;
}

/* --------------------------------- identify --------------------------------- */

export interface IdentifyResult {
  ok: true;
  props: ProfileProps;
  woke: number;
  started: string[];
}

/** Merge profile properties, then wake property waits and re-evaluate segment triggers. */
export async function identifyUser(
  env: JourneyEnv,
  userId: string,
  props: ProfileProps,
  store: JourneyStore = d1Store(env)
): Promise<IdentifyResult> {
  const ts = Date.now();
  const merged = await store.mergeProfile(userId, props);
  // Property-condition waits subscribe to this reserved event (see relevantEvents)
  const woke = await wakeSubscribers(env, store, userId, PROFILE_UPDATED_EVENT);
  // A profile change can move the user into (or out of) a trigger-routed segment
  const started = await refreshSegmentTriggers(env, store, userId, ts);
  return { ok: true, props: merged, woke, started };
}

/* ---------------------------------- deploy ---------------------------------- */

export interface DeployResult {
  workflows: string[];
  /**
   * Workflows whose trigger type has no runtime routing yet — they deploy (the
   * IR is stored and versioned) but will never start until the routing lands.
   * Currently: date (TODO — needs cron + Queues, instance creation is
   * rate-limited and a date trigger fans out to the whole audience at once)
   * and webhook (TODO — needs endpoint allocation).
   */
  unrouted: { workflow: string; trigger: TriggerIR['type'] }[];
}

/** Bundle deploy, terraform-apply style: workflow bodies first (content-addressed, so a failed deploy leaves only harmless orphans), then the routing swap. */
export async function deployBundle(
  env: JourneyEnv,
  bundle: unknown,
  store: JourneyStore = d1Store(env)
): Promise<DeployResult> {
  const parsed = BundleIR.parse(bundle);

  for (const workflow of parsed.workflows) await store.putWorkflowIR(workflow);
  await store.replaceRoutes(parsed);

  const unrouted = parsed.workflows
    .filter((workflow) => workflow.trigger.type === 'date' || workflow.trigger.type === 'webhook')
    .map((workflow) => ({ workflow: workflow.name, trigger: workflow.trigger.type }));

  return {
    workflows: parsed.workflows.map((w) => `${w.name}@${w.contentHash.slice(0, 8)}`),
    unrouted,
  };
}

/* ----------------------------------- http ----------------------------------- */

export async function handleRequest(
  request: Request,
  env: JourneyEnv,
  store: JourneyStore = d1Store(env)
): Promise<Response> {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true });
  }

  // Bearer auth on everything mutating. An unset token means an open dev
  // instance (see JourneyEnv.API_TOKEN) — production must configure it.
  if (env.API_TOKEN !== undefined) {
    if (request.headers.get('authorization') !== `Bearer ${env.API_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  try {
    if (request.method === 'POST' && url.pathname === '/events') {
      const input = (await request.json()) as IngestInput;
      if (!input.userId || !input.event) return json({ error: 'userId and event required' }, 400);
      if (input.event.startsWith('$')) {
        return json({ error: 'event names starting with $ are reserved' }, 400);
      }
      return json(await ingestEvent(env, input, store));
    }

    if (request.method === 'POST' && url.pathname === '/identify') {
      const { userId, props } = (await request.json()) as { userId: string; props?: ProfileProps };
      if (!userId) return json({ error: 'userId required' }, 400);
      return json(await identifyUser(env, userId, props ?? {}, store));
    }

    if (request.method === 'POST' && url.pathname === '/deploy') {
      return json(await deployBundle(env, await request.json(), store));
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    // Validation problems are the caller's to fix; anything else stays out of
    // the response body (internals are logged, not leaked).
    if (error instanceof z.core.$ZodError) {
      return json({ error: `invalid payload: ${error.message}` }, 400);
    }
    console.error('[workflow router]', error);
    return json({ error: 'internal error' }, 500);
  }
}
