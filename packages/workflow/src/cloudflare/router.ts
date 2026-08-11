import { evaluateCondition } from '../engine/condition';
import { BundleIR, ConditionIR } from '../ir';
import { type JourneyEnv, type JourneyParams, WAKE_EVENT_TYPE } from './bindings';
import { D1FactSource } from './facts';

/**
 * Ingest router. An incoming event does three things: it is stored, it wakes
 * waiting instances, and it is matched against triggers to start new journeys.
 * Plus /deploy (persist a bundle) and /identify (merge a profile).
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
    try {
      const instance = await env.JOURNEY.get(row.handle);
      await instance.sendEvent({ type: WAKE_EVENT_TYPE, payload: { event } });
      woke++;
    } catch {
      // Instance finished or never existed: drop the dangling subscription
      await env.DB.prepare('DELETE FROM subscriptions WHERE wake_handle = ?')
        .bind(row.handle)
        .run();
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

    // Entry policy, MVP: once — a user enters a given workflow a single time
    const existing = await env.DB.prepare(
      'SELECT 1 AS x FROM entries WHERE workflow = ? AND user_id = ?'
    )
      .bind(row.workflow, input.userId)
      .first<{ x: number }>();
    if (existing) continue;

    const instanceId = buildInstanceId(row.workflow, row.hash, input.userId, ts);
    const params: JourneyParams = {
      workflowName: row.workflow,
      contentHash: row.hash,
      userId: input.userId,
      trigger: { event: input.event, payload: input.payload ?? {} },
    };

    await env.DB.prepare(
      'INSERT INTO entries (workflow, user_id, instance_id, hash, status, ts) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(row.workflow, input.userId, instanceId, row.hash, 'running', ts)
      .run();
    await env.JOURNEY.create({ id: instanceId, params });
    started.push(instanceId);
  }
  return started;
}

/** Instance id: addressable (the router gets it directly to wake it), ≤100 chars, legal charset. */
function buildInstanceId(workflow: string, hash: string, userId: string, ts: number): string {
  const uid = userId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
  return `${workflow.slice(0, 32)}-${hash.slice(0, 8)}-${uid}-${ts.toString(36)}`;
}

/* ---------------------------------- deploy ---------------------------------- */

/** Bundle deploy, terraform-apply style: workflows go to KV (content-addressed) while trigger routes and segment definitions are swapped into D1. */
export async function deployBundle(
  env: JourneyEnv,
  bundle: unknown
): Promise<{ workflows: string[] }> {
  const parsed = BundleIR.parse(bundle);

  await env.DB.prepare('DELETE FROM triggers').run();
  await env.DB.prepare('DELETE FROM segments').run();

  for (const segment of parsed.segments) {
    await env.DB.prepare('INSERT INTO segments (name, condition, hash) VALUES (?, ?, ?)')
      .bind(segment.name, JSON.stringify(segment.condition), segment.contentHash)
      .run();
  }

  const deployed: string[] = [];
  for (const workflow of parsed.workflows) {
    await env.WORKFLOW_KV.put(`wf:${workflow.contentHash}`, JSON.stringify(workflow));
    if (workflow.trigger.type === 'event') {
      await env.DB.prepare(
        'INSERT INTO triggers (workflow, hash, event, filter) VALUES (?, ?, ?, ?)'
      )
        .bind(
          workflow.name,
          workflow.contentHash,
          workflow.trigger.event,
          workflow.trigger.filter !== undefined ? JSON.stringify(workflow.trigger.filter) : null
        )
        .run();
    }
    // segment/date/webhook triggers come later (segments need materialized membership; date goes through cron + Queues)
    deployed.push(`${workflow.name}@${workflow.contentHash.slice(0, 8)}`);
  }
  return { workflows: deployed };
}

/* ----------------------------------- http ----------------------------------- */

export async function handleRequest(request: Request, env: JourneyEnv): Promise<Response> {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/events') {
      const input = (await request.json()) as IngestInput;
      if (!input.userId || !input.event) return json({ error: 'userId and event required' }, 400);
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
      return json({ ok: true, props: merged });
    }

    if (request.method === 'POST' && url.pathname === '/deploy') {
      return json(await deployBundle(env, await request.json()));
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
