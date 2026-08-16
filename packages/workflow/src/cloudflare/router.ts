import * as z from 'zod/mini';
import { murmur3 } from '../engine/bucket';
import { PROFILE_UPDATED_EVENT, evaluateCondition, matchesWhere } from '../engine/condition';
import { BundleIR, ConditionIR, type TriggerIR } from '../ir';
import {
  type JourneyEnv,
  type JourneyParams,
  WAKE_EVENT_TYPE,
  type WorkflowInstanceLike,
} from './bindings';
import { D1FactSource } from './facts';

/**
 * Ingest router. An incoming event does four things: it is stored, it wakes
 * waiting instances, it is matched against event triggers, and it re-evaluates
 * segment-trigger membership. Plus /deploy (persist a bundle) and /identify
 * (merge a profile — which wakes property-condition waits via
 * PROFILE_UPDATED_EVENT and re-evaluates segment triggers too).
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

export async function ingestEvent(env: JourneyEnv, input: IngestInput): Promise<IngestResult> {
  if (input.event.startsWith('$')) {
    throw new Error(`event name '${input.event}' is reserved ('$' prefix is internal)`);
  }
  const ts = input.ts ?? Date.now();
  const payload = input.payload ?? {};

  await env.DB.prepare('INSERT INTO events (user_id, name, ts, payload) VALUES (?, ?, ?, ?)')
    .bind(input.userId, input.event, ts, JSON.stringify(payload))
    .run();

  const woke = await wakeSubscribers(env, input.userId, input.event);
  const started = await startTriggeredJourneys(env, input, ts);
  started.push(...(await refreshSegmentTriggers(env, input.userId, ts)));
  return { stored: true, woke, started };
}

async function wakeSubscribers(env: JourneyEnv, userId: string, event: string): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT wake_handle AS handle FROM subscriptions WHERE user_id = ? AND event = ?'
  )
    .bind(userId, event)
    .all<{ handle: string }>();

  let woke = 0;
  for (const row of results) {
    let instance: WorkflowInstanceLike;
    try {
      instance = await env.JOURNEY.get(row.handle);
    } catch {
      // Unknown instance (errored out without cleanup): drop the dangling subscription
      await env.DB.prepare('DELETE FROM subscriptions WHERE wake_handle = ?')
        .bind(row.handle)
        .run();
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
  input: IngestInput,
  ts: number
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT workflow, hash, "where" AS whereClause, filter FROM triggers WHERE event = ?'
  )
    .bind(input.event)
    .all<{ workflow: string; hash: string; whereClause: string | null; filter: string | null }>();

  const started: string[] = [];
  for (const row of results) {
    // where: the payload gate — evaluated against the incoming event first
    if (row.whereClause !== null) {
      const where = ConditionIR.parse(JSON.parse(row.whereClause));
      if (!matchesWhere(input.payload ?? {}, where)) continue;
    }

    // filter: the profile gate
    if (row.filter !== null) {
      const condition = ConditionIR.parse(JSON.parse(row.filter));
      const facts = new D1FactSource(env.DB, input.userId);
      if (!(await evaluateCondition(condition, facts, ts))) continue;
    }

    const instanceId = await startJourney(env, row.workflow, row.hash, input.userId, ts, {
      event: input.event,
      payload: input.payload ?? {},
    });
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
  userId: string,
  ts: number
): Promise<string[]> {
  const { results: routes } = await env.DB.prepare(
    'SELECT workflow, hash, segment FROM segment_triggers'
  ).all<{ workflow: string; hash: string; segment: string }>();
  if (routes.length === 0) return [];

  const facts = new D1FactSource(env.DB, userId);
  const bySegment = new Map<string, { workflow: string; hash: string }[]>();
  for (const route of routes) {
    const list = bySegment.get(route.segment) ?? [];
    list.push({ workflow: route.workflow, hash: route.hash });
    bySegment.set(route.segment, list);
  }

  const started: string[] = [];
  for (const [segmentName, segmentRoutes] of bySegment) {
    const definition = await facts.getSegmentCondition(segmentName);
    if (definition === undefined) continue; // route without a definition: broken deploy, skip

    const matches = await evaluateCondition(definition, facts, ts);
    const member = await env.DB.prepare(
      'SELECT 1 AS x FROM segment_members WHERE segment = ? AND user_id = ?'
    )
      .bind(segmentName, userId)
      .first<{ x: number }>();

    if (matches && member === null) {
      // Entry transition: record membership, then start the routed workflows
      await env.DB.prepare(
        'INSERT OR IGNORE INTO segment_members (segment, user_id, ts) VALUES (?, ?, ?)'
      )
        .bind(segmentName, userId, ts)
        .run();
      for (const route of segmentRoutes) {
        const instanceId = await startJourney(env, route.workflow, route.hash, userId, ts, {
          event: '$segment_entry',
          payload: { segment: segmentName },
        });
        if (instanceId !== null) started.push(instanceId);
      }
    } else if (!matches && member !== null) {
      await env.DB.prepare('DELETE FROM segment_members WHERE segment = ? AND user_id = ?')
        .bind(segmentName, userId)
        .run();
    }
  }
  return started;
}

/**
 * Create one journey instance behind the entry ledger. Returns null when the
 * once-policy blocks the entry (the entries PK makes the check atomic, so
 * concurrent ingests cannot double-enter).
 */
async function startJourney(
  env: JourneyEnv,
  workflow: string,
  hash: string,
  userId: string,
  ts: number,
  trigger: { event: string; payload: Record<string, unknown> }
): Promise<string | null> {
  const instanceId = buildInstanceId(workflow, hash, userId, ts);
  const params: JourneyParams = { workflowName: workflow, contentHash: hash, userId, trigger };

  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(workflow, userId, instanceId, hash, 'running', ts)
    .run();
  if ((inserted.meta?.changes ?? 1) === 0) return null; // already entered

  try {
    await env.JOURNEY.create({ id: instanceId, params });
  } catch (error) {
    // Roll the ledger back so a retried ingest can enter — otherwise the
    // once-policy would permanently record an entry that never ran.
    await env.DB.prepare('DELETE FROM entries WHERE instance_id = ?').bind(instanceId).run();
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

/** Bundle deploy, terraform-apply style: workflows go to KV (content-addressed) while trigger routes and segment definitions are swapped into D1. */
export async function deployBundle(env: JourneyEnv, bundle: unknown): Promise<DeployResult> {
  const parsed = BundleIR.parse(bundle);

  // KV first: content-addressed, so a failed deploy leaves only harmless orphans
  for (const workflow of parsed.workflows) {
    await env.WORKFLOW_KV.put(`wf:${workflow.contentHash}`, JSON.stringify(workflow));
  }

  // One atomic batch for the D1 swap: all-or-nothing, and a concurrent ingest
  // never observes the half-empty routing table a delete-then-insert loop had.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM triggers'),
    env.DB.prepare('DELETE FROM segment_triggers'),
    env.DB.prepare('DELETE FROM segments'),
    ...parsed.segments.map((segment) =>
      env.DB.prepare('INSERT INTO segments (name, condition, hash) VALUES (?, ?, ?)').bind(
        segment.name,
        JSON.stringify(segment.condition),
        segment.contentHash
      )
    ),
    ...parsed.workflows.flatMap((workflow) => {
      if (workflow.trigger.type === 'event') {
        return [
          env.DB.prepare(
            'INSERT INTO triggers (workflow, hash, event, "where", filter) VALUES (?, ?, ?, ?, ?)'
          ).bind(
            workflow.name,
            workflow.contentHash,
            workflow.trigger.event,
            workflow.trigger.where !== undefined ? JSON.stringify(workflow.trigger.where) : null,
            workflow.trigger.filter !== undefined ? JSON.stringify(workflow.trigger.filter) : null
          ),
        ];
      }
      if (workflow.trigger.type === 'segment') {
        return [
          env.DB.prepare(
            'INSERT INTO segment_triggers (workflow, hash, segment) VALUES (?, ?, ?)'
          ).bind(workflow.name, workflow.contentHash, workflow.trigger.segment),
        ];
      }
      return [];
    }),
  ]);

  const unrouted = parsed.workflows
    .filter((workflow) => workflow.trigger.type === 'date' || workflow.trigger.type === 'webhook')
    .map((workflow) => ({ workflow: workflow.name, trigger: workflow.trigger.type }));

  return {
    workflows: parsed.workflows.map((w) => `${w.name}@${w.contentHash.slice(0, 8)}`),
    unrouted,
  };
}

/* ----------------------------------- http ----------------------------------- */

export async function handleRequest(request: Request, env: JourneyEnv): Promise<Response> {
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
      return json(await ingestEvent(env, input));
    }

    if (request.method === 'POST' && url.pathname === '/identify') {
      const { userId, props } = (await request.json()) as {
        userId: string;
        props: Record<string, unknown>;
      };
      if (!userId) return json({ error: 'userId required' }, 400);
      const ts = Date.now();
      const existing = await env.DB.prepare('SELECT props FROM profiles WHERE user_id = ?')
        .bind(userId)
        .first<{ props: string }>();
      const merged = {
        ...(existing ? (JSON.parse(existing.props) as Record<string, unknown>) : {}),
        ...props,
      };
      await env.DB.prepare(
        'INSERT INTO profiles (user_id, props) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET props = excluded.props'
      )
        .bind(userId, JSON.stringify(merged))
        .run();
      // Property-condition waits subscribe to this reserved event (see relevantEvents)
      const woke = await wakeSubscribers(env, userId, PROFILE_UPDATED_EVENT);
      // A profile change can move the user into (or out of) a trigger-routed segment
      const started = await refreshSegmentTriggers(env, userId, ts);
      return json({ ok: true, props: merged, woke, started });
    }

    if (request.method === 'POST' && url.pathname === '/deploy') {
      return json(await deployBundle(env, await request.json()));
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
