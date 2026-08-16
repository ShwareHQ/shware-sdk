import * as z from 'zod/mini';
import { murmur3 } from '../engine/bucket';
import { PROFILE_UPDATED_EVENT, evaluateCondition } from '../engine/condition';
import { BundleIR, ConditionIR } from '../ir';
import {
  type JourneyEnv,
  type JourneyParams,
  WAKE_EVENT_TYPE,
  type WorkflowInstanceLike,
} from './bindings';
import { D1FactSource } from './facts';

/**
 * Ingest router. An incoming event does three things: it is stored, it wakes
 * waiting instances, and it is matched against triggers to start new journeys.
 * Plus /deploy (persist a bundle) and /identify (merge a profile — which also
 * wakes property-condition waits via PROFILE_UPDATED_EVENT).
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
    'SELECT workflow, hash, filter FROM triggers WHERE event = ?'
  )
    .bind(input.event)
    .all<{ workflow: string; hash: string; filter: string | null }>();

  const started: string[] = [];
  for (const row of results) {
    // trigger filter: the entry gate
    if (row.filter !== null) {
      const condition = ConditionIR.parse(JSON.parse(row.filter));
      const facts = new D1FactSource(env.DB, input.userId);
      if (!(await evaluateCondition(condition, facts, ts))) continue;
    }

    const instanceId = buildInstanceId(row.workflow, row.hash, input.userId, ts);
    const params: JourneyParams = {
      workflowName: row.workflow,
      contentHash: row.hash,
      userId: input.userId,
      trigger: { event: input.event, payload: input.payload ?? {} },
    };

    // Entry policy, MVP: once — enforced atomically by the entries PK
    // (workflow, user_id); OR IGNORE makes concurrent ingests race-safe.
    const inserted = await env.DB.prepare(
      'INSERT OR IGNORE INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(row.workflow, input.userId, instanceId, row.hash, 'running', ts)
      .run();
    if ((inserted.meta?.changes ?? 1) === 0) continue; // already entered

    try {
      await env.JOURNEY.create({ id: instanceId, params });
    } catch (error) {
      // Roll the ledger back so a retried ingest can enter — otherwise the
      // once-policy would permanently record an entry that never ran.
      await env.DB.prepare('DELETE FROM entries WHERE instance_id = ?').bind(instanceId).run();
      throw error;
    }
    started.push(instanceId);
  }
  return started;
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

/** Bundle deploy, terraform-apply style: workflows go to KV (content-addressed) while trigger routes and segment definitions are swapped into D1. */
export async function deployBundle(
  env: JourneyEnv,
  bundle: unknown
): Promise<{ workflows: string[] }> {
  const parsed = BundleIR.parse(bundle);

  // KV first: content-addressed, so a failed deploy leaves only harmless orphans
  for (const workflow of parsed.workflows) {
    await env.WORKFLOW_KV.put(`wf:${workflow.contentHash}`, JSON.stringify(workflow));
  }

  // One atomic batch for the D1 swap: all-or-nothing, and a concurrent ingest
  // never observes the half-empty routing table a delete-then-insert loop had.
  // segment/date/webhook triggers come later (segments need materialized membership; date goes through cron + Queues)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM triggers'),
    env.DB.prepare('DELETE FROM segments'),
    ...parsed.segments.map((segment) =>
      env.DB.prepare('INSERT INTO segments (name, condition, hash) VALUES (?, ?, ?)').bind(
        segment.name,
        JSON.stringify(segment.condition),
        segment.contentHash
      )
    ),
    ...parsed.workflows.flatMap((workflow) =>
      workflow.trigger.type === 'event'
        ? [
            env.DB.prepare(
              'INSERT INTO triggers (workflow, hash, event, filter) VALUES (?, ?, ?, ?)'
            ).bind(
              workflow.name,
              workflow.contentHash,
              workflow.trigger.event,
              workflow.trigger.filter !== undefined ? JSON.stringify(workflow.trigger.filter) : null
            ),
          ]
        : []
    ),
  ]);

  return {
    workflows: parsed.workflows.map((w) => `${w.name}@${w.contentHash.slice(0, 8)}`),
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
      if (input.event.startsWith('$'))
        return json({ error: 'event names starting with $ are reserved' }, 400);
      return json(await ingestEvent(env, input));
    }

    if (request.method === 'POST' && url.pathname === '/identify') {
      const { userId, props } = (await request.json()) as {
        userId: string;
        props: Record<string, unknown>;
      };
      if (!userId) return json({ error: 'userId required' }, 400);
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
      return json({ ok: true, props: merged, woke });
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
