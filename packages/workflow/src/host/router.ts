import * as z from 'zod/mini';
import {
  type JourneyEnv,
  type JourneyParams,
  WAKE_EVENT_TYPE,
  type WorkflowInstanceLike,
  isInstanceNotFound,
} from '../cloudflare/bindings';
import { d1Store } from '../cloudflare/d1-env';
import { type Contract, type ContractResult, checkEvent } from '../contract';
import { murmur3 } from '../engine/bucket';
import {
  DEVICES_UPDATED_EVENT,
  PROFILE_UPDATED_EVENT,
  evaluateCondition,
  matchesWhere,
  profileUpdatedEvent,
} from '../engine/condition';
import { semanticHash } from '../hash';
import { BundleIR, type ConditionIR, type TriggerIR } from '../ir';
import { recordPushOpen } from '../reporting/tracking';
import { JourneyFactSource } from '../store/facts';
import {
  type BundleVersion,
  type JourneyStore,
  type ProfileProps,
  SchemaMismatchError,
  type SegmentTriggerRoute,
} from '../store/index';
import { authorized } from './auth';

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

/**
 * The user is being erased (`forgetUser` recorded it, their instances are being stopped): nothing
 * may be written about them until the erase is through, or it would come back after it.
 */
export class UserErasedError extends Error {
  override readonly name = 'UserErasedError';
  constructor(readonly userId: string) {
    super(`user ${userId} is being erased`);
  }
}

/** Refuse the write when the user's erasure is pending: every ingest-side entry point starts here. */
async function refuseIfErased(store: JourneyStore, userId: string): Promise<void> {
  if (await store.erasurePending(userId)) throw new UserErasedError(userId);
}

export interface IngestInput {
  userId: string;
  event: string;
  payload?: Record<string, unknown>;
  ts?: number;
  /**
   * This occurrence's identity, and with it the idempotency of sending it.
   *
   * Only the sender can know whether two deliveries describe one occurrence or
   * two, so the engine does not decide: an id it has already stored makes the
   * second delivery a no-op. That matters because ingest is reachable from two
   * retrying callers — an HTTP client retrying a 500, and the interpreter's
   * send_event step being retried after it already committed its row — and a
   * second copy of an event silently changes every count- and window-based
   * condition that reads the log.
   *
   * Callers that retry should send an id they can reproduce. Omitting it gets
   * a fresh one, which records the event as its own occurrence.
   */
  id?: string;
}

export interface IngestResult {
  /** The occurrence's identity: the caller's `id`, or the one minted for it. */
  id: string;
  /** False when that id was already in the log: nothing was written this time. */
  stored: boolean;
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
  // Also reached from a running instance's send_event: an erased user's instances are stopped
  // before the erase, so one that still gets here is refused like any other writer
  await refuseIfErased(store, input.userId);
  const ts = input.ts ?? Date.now();
  const payload = input.payload ?? {};
  // No id means the sender is not claiming this is a repeat of anything, which
  // a fresh one states truthfully — unlike a key derived from the contents,
  // which would silently collapse two identical events a second apart.
  const id = input.id ?? crypto.randomUUID();

  const stored = await store.insertEvent({
    id,
    userId: input.userId,
    event: input.event,
    ts,
    payload,
  });

  /*
   * The rest runs even for a duplicate. A retry arrives precisely because the
   * first attempt did not finish — it committed the row and then failed — so
   * returning early would strand the journeys the retry exists to start. Both
   * halves are independently idempotent: waking an instance that already moved
   * on is a no-op, and the entry ledger refuses a second entry.
   */
  const woke = await wakeSubscribers(env, store, input.userId, [input.event]);
  const started = await startTriggeredJourneys(env, store, { ...input, payload }, ts);
  started.push(...(await refreshSegmentTriggers(env, store, input.userId, ts)));
  return { id, stored, woke, started };
}

/**
 * Wake every instance of the user waiting on any of `events`, once each: an instance subscribed
 * to several of them (a wait on two profile properties, patched together) gets one wake-up, and
 * the payload names the first event it matched.
 */
export async function wakeSubscribers(
  env: JourneyEnv,
  store: JourneyStore,
  userId: string,
  events: readonly string[]
): Promise<number> {
  const handles = new Map<string, string>(); // handle → the event that matched it first
  for (const event of events) {
    for (const handle of await store.findWakeHandles(userId, event)) {
      if (!handles.has(handle)) handles.set(handle, event);
    }
  }
  let woke = 0;
  for (const [handle, event] of handles) {
    let instance: WorkflowInstanceLike;
    try {
      instance = await env.JOURNEY.get(handle);
    } catch (error) {
      // Unknown instance (errored out without cleanup): drop the dangling subscription. Any
      // other failure (a database blip) keeps it: deleting would silence the wait for good
      if (isInstanceNotFound(error)) await store.unsubscribe(handle);
      else console.warn(`[workflow] looking up ${handle} to wake it failed`, error);
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
      },
      route.version
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
 * segment turning true by clock alone) has no event to ride on: the scheduled
 * sweep catches it (`sweepSegments`).
 */
export async function refreshSegmentTriggers(
  env: JourneyEnv,
  store: JourneyStore,
  userId: string,
  ts: number
): Promise<string[]> {
  return refreshSegments(env, store, userId, ts, await store.listSegmentTriggers());
}

/**
 * Re-evaluate segments for one user — the routed ones only, or with `segments` every one named —
 * and act on each membership transition: entering records the membership and starts the
 * segment's routed workflows, leaving drops it. A segment trigger therefore starts journeys for
 * users who enter after it is deployed; a user already a member is not entered again.
 */
async function refreshSegments(
  env: JourneyEnv,
  store: JourneyStore,
  userId: string,
  ts: number,
  routes: readonly SegmentTriggerRoute[],
  segments: readonly string[] = [],
  // A sweep loads each definition once for all its users, not once per user
  definitions = new Map<string, ConditionIR | undefined>()
): Promise<string[]> {
  const bySegment = new Map<string, { workflow: string; hash: string; version?: string }[]>(
    segments.map((name) => [name, []])
  );
  for (const route of routes) {
    const list = bySegment.get(route.segment) ?? [];
    list.push({
      workflow: route.workflow,
      hash: route.hash,
      ...(route.version === undefined ? {} : { version: route.version }),
    });
    bySegment.set(route.segment, list);
  }
  if (bySegment.size === 0) return [];

  const facts = new JourneyFactSource(store, userId);
  const started: string[] = [];
  const failures: unknown[] = [];
  for (const [segmentId, segmentRoutes] of bySegment) {
    if (!definitions.has(segmentId)) {
      definitions.set(segmentId, await store.getSegmentCondition(segmentId));
    }
    const definition = definitions.get(segmentId);
    if (definition === undefined) continue; // route without a definition: broken deploy, skip

    const matches = await evaluateCondition(definition, facts, ts);
    const member = await store.isSegmentMember(segmentId, userId);

    if (matches && !member) {
      // Entry transition: the membership and the starts it owes, recorded together
      await store.addSegmentMember(
        segmentId,
        userId,
        ts,
        segmentRoutes.map((route) => route.workflow)
      );
    } else if (!matches && member) {
      await store.removeSegmentMember(segmentId, userId);
      continue;
    }
    if (!matches) continue;

    // Every start the entry still owes — a fresh entry's, or one an earlier evaluation failed on.
    // Each is crossed off once its instance exists, so one workflow failing neither blocks the
    // others nor gets lost: the next evaluation (the sweep, the user's next event) retries it.
    const pending = new Set(await store.pendingSegmentStarts(segmentId, userId));
    for (const route of segmentRoutes) {
      if (!pending.has(route.workflow)) continue;
      try {
        const instanceId = await startJourney(
          env,
          store,
          route.workflow,
          route.hash,
          userId,
          ts,
          { event: '$segment_entry', payload: { segment: segmentId } },
          route.version
        );
        if (instanceId !== null) started.push(instanceId);
        await store.completeSegmentStart(segmentId, userId, route.workflow);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  // Surface a failure to the caller (an ingest answers 500) once every start had its chance
  if (failures.length > 0) throw failures[0];
  return started;
}

export interface SweepResult {
  users: number;
  /** Journeys the segments' entries started. */
  started: string[];
  /** Each deployed segment's size after the sweep (empty when the store keeps no reporting). */
  sizes: { segment: string; size: number }[];
}

/** How many users one sweep page evaluates: a unit of resumable work (AWS checkpoints each). */
export const SWEEP_PAGE_SIZE = 500;

/**
 * What the sweep does before it looks at any user: the runtime's own upkeep (AWS: unconfirmed
 * starts, executions that ended unseen) and the erasures left unfinished (an instance would not
 * stop). A failure of either is logged, never fatal: the pages still run. Users whose erasure is
 * still pending afterwards are skipped by every page (`sweepSegmentsPaged`).
 */
export async function sweepMaintenance(env: JourneyEnv, store: JourneyStore): Promise<void> {
  try {
    await env.JOURNEY.maintain?.();
  } catch (error) {
    console.error('[workflow] runtime maintenance failed', error);
  }
  for (const userId of await store.pendingErasures()) {
    try {
      await eraseUser(env, userId, store);
    } catch (error) {
      // Still pending: the next sweep tries again, and the rest of this one goes on
      console.error(`[workflow] erasure of ${userId} failed`, error);
    }
  }
}

export interface SweepPage {
  /** Users evaluated on this page (those being erased are listed but skipped). */
  users: number;
  /** Journeys the segments' entries started on this page. */
  started: string[];
  /** The last user id listed, to resume past (`after`); undefined when the page was empty. */
  lastUserId?: string | undefined;
  /** Whether the page was full, so another may follow. */
  more: boolean;
}

/**
 * One page of the sweep: the users after `after` (ascending, at most `limit`), every deployed
 * segment evaluated for each. The pages are what makes the sweep resumable — a host whose run
 * can be cut short (a Lambda timeout) checkpoints each one and replays the checkpointed pages
 * instead of starting over; `sweepSegments` is the plain loop over them.
 */
export async function sweepSegmentsPaged(
  env: JourneyEnv,
  store: JourneyStore,
  page: { after?: string | undefined; limit?: number | undefined; now?: number | undefined }
): Promise<SweepPage> {
  const now = page.now ?? Date.now();
  const limit = page.limit ?? SWEEP_PAGE_SIZE;
  const segments = (await store.listSegments()).map((segment) => segment.id);
  const routes = await store.listSegmentTriggers();
  // Read per page, not once up front: an erasure requested since the last page is honored too
  const erasing = new Set(await store.pendingErasures());
  const listed = await store.listUserIds({ after: page.after, limit });
  const lastUserId = listed.at(-1);
  // A store that ignores `after` would hand back the same page forever: refuse to loop on it
  if (page.after !== undefined && lastUserId !== undefined && lastUserId <= page.after) {
    throw new Error(`listUserIds did not advance past ${page.after}: the store ignores 'after'`);
  }
  const users = listed.filter((userId) => !erasing.has(userId));
  const started: string[] = [];
  const definitions = new Map<string, ConditionIR | undefined>();
  for (const userId of users) {
    try {
      started.push(
        ...(await refreshSegments(env, store, userId, now, routes, segments, definitions))
      );
    } catch (error) {
      // One user's failed start is kept for the next sweep; it must not stop everyone else's
      console.error(`[workflow] segment refresh for ${userId} failed`, error);
    }
  }
  return { users: users.length, started, lastUserId, more: listed.length >= limit };
}

/**
 * The scheduled sweep: every deployed segment evaluated for every known user — the evaluator a
 * journey's conditions run on, so a member is exactly who a journey would see in it. Membership
 * follows (joiners keep the time they joined, leavers are removed), segment triggers start the
 * journeys of whoever entered by the clock alone, and the store records each segment's size.
 * It walks users page by page (`sweepSegmentsPaged`): fine for thousands, a large audience wants
 * SQL-side evaluation.
 */
export async function sweepSegments(
  env: JourneyEnv,
  store: JourneyStore,
  now = Date.now()
): Promise<SweepResult> {
  await sweepMaintenance(env, store);
  let users = 0;
  const started: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await sweepSegmentsPaged(env, store, { after, limit: SWEEP_PAGE_SIZE, now });
    users += page.users;
    started.push(...page.started);
    if (!page.more || page.lastUserId === undefined) break;
    after = page.lastUserId;
  }
  const sizes = (await store.reporting?.snapshotSegments(now)) ?? [];
  return { users, started, sizes };
}

/**
 * Create one journey instance behind the entry ledger. Returns null when the
 * once-policy blocks the entry (the store's attempt is atomic, so concurrent
 * ingests cannot double-enter). A pair whose previous instance is recorded as
 * 'failed' is reclaimed rather than barred forever over one outage.
 */
async function startJourney(
  env: JourneyEnv,
  store: JourneyStore,
  workflow: string,
  hash: string,
  userId: string,
  ts: number,
  trigger: { event: string; payload: Record<string, unknown> },
  /** The code version whose bundle routed this start, read with the hash (see TriggerRoute). */
  version?: string
): Promise<string | null> {
  const instanceId = buildInstanceId(workflow, hash, userId, ts);
  const params: JourneyParams = { workflowId: workflow, contentHash: hash, userId, trigger };
  const execution = await env.JOURNEY.plan?.({ id: instanceId, params, ts, version });

  const outcome = await store.enterJourney({ workflow, userId, instanceId, hash, ts, execution });
  if (outcome === null) {
    // Already entered and still alive — unless its start never got through: this retry is the
    // first chance to finish it
    await env.JOURNEY.resume?.({ workflow, userId });
    return null;
  }

  try {
    await env.JOURNEY.create({ id: instanceId, params });
  } catch (error) {
    // A recorded start stays: the runtime may have taken it, and a retry with the same name
    // and payload finds that execution instead of starting a second one
    if (execution !== undefined) throw error;
    if (outcome === 'reclaimed') {
      // Put the corpse back rather than deleting it: the entry is still a
      // failure, and dropping the row would erase that from the ledger.
      await store.setEntryStatus(instanceId, 'failed');
    } else {
      // Roll the ledger back so a retried ingest can enter — otherwise the
      // once-policy would permanently record an entry that never ran.
      await store.removeEntry(instanceId);
    }
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

/**
 * Merge-patch profile properties (a null removes one), then wake property waits
 * and re-evaluate segment triggers. The merge is one statement in the store, so
 * two identifies landing together cannot lose each other's fields.
 */
export async function identifyUser(
  env: JourneyEnv,
  userId: string,
  props: ProfileProps,
  store: JourneyStore = d1Store(env)
): Promise<IdentifyResult> {
  await refuseIfErased(store, userId);
  const ts = Date.now();
  const merged = await store.mergeProfile(userId, props);
  // A property wait subscribes to its own property's channel (see relevantEvents): only the
  // waits on what this patch touched wake up. The unscoped PROFILE_UPDATED_EVENT is still fired
  // for instances that subscribed before 4.0 (in flight across the upgrade): remove it in the
  // next major.
  const woke = await wakeSubscribers(env, store, userId, [
    ...Object.keys(props).map(profileUpdatedEvent),
    PROFILE_UPDATED_EVENT,
  ]);
  // A profile change can move the user into (or out of) a trigger-routed segment
  const started = await refreshSegmentTriggers(env, store, userId, ts);
  return { ok: true, props: merged, woke, started };
}

export interface DeviceRegistration {
  userId: string;
  token: string;
  platform: string;
  ts?: number;
}

/**
 * A push token registered for the user (or moved to them from another account: a token belongs
 * to one user at a time). Wakes the waits that read devices (`reachable('push')` inside
 * `waitUntil`), for the new owner and the previous one.
 */
export async function registerDevice(
  env: JourneyEnv,
  device: DeviceRegistration,
  store: JourneyStore = d1Store(env)
): Promise<{ ok: true; woke: number }> {
  await refuseIfErased(store, device.userId);
  const previous = await store.removeDevice(device.token);
  await store.upsertDevice({ ...device, ts: device.ts ?? Date.now() });
  let woke = await wakeSubscribers(env, store, device.userId, [DEVICES_UPDATED_EVENT]);
  if (previous !== undefined && previous !== device.userId) {
    woke += await wakeSubscribers(env, store, previous, [DEVICES_UPDATED_EVENT]);
  }
  return { ok: true, woke };
}

/**
 * A deleted account: everything the engine keeps about the user is erased and the journeys still
 * running for them are terminated, so nothing more is sent. Idempotent.
 */
/** Workflow instance states that will never run another step. */
const STOPPED_STATUSES = new Set(['complete', 'errored', 'terminated']);

/**
 * Stop one instance for good; true once it is known not to run again. An instance the platform
 * no longer knows, or one already finished (terminate refuses those), counts as stopped. Any other
 * failure is not taken for "already gone": it answers false, and the erasure waits for a retry.
 */
async function stopInstance(env: JourneyEnv, instanceId: string): Promise<boolean> {
  let instance: WorkflowInstanceLike;
  try {
    instance = await env.JOURNEY.get(instanceId);
  } catch (error) {
    if (isInstanceNotFound(error)) return true;
    console.warn(`[workflow] looking up ${instanceId} to stop it failed`, error);
    return false;
  }
  if (instance.terminate === undefined) return false;
  try {
    await instance.terminate();
    return true;
  } catch (error) {
    const status = await instance.status?.().catch(() => undefined);
    if (status !== undefined && STOPPED_STATUSES.has(status.status)) return true;
    console.warn(`[workflow] terminating ${instanceId} failed`, error);
    return false;
  }
}

/**
 * Carry out a recorded erasure: stop every running instance of the user, and only once all have
 * stopped erase their data (the request with it). Stopping first means no step can write rows
 * back after the erase; erasing nothing until then keeps the entries that name the instances
 * still to stop, so a retry can finish the job.
 */
async function eraseUser(
  env: JourneyEnv,
  userId: string,
  store: JourneyStore
): Promise<{ erased: boolean; pending: string[] }> {
  const pending: string[] = [];
  for (const instanceId of await store.runningInstances(userId)) {
    if (!(await stopInstance(env, instanceId))) pending.push(instanceId);
  }
  if (pending.length > 0) return { erased: false, pending };
  await store.forgetUser(userId);
  return { erased: true, pending };
}

/**
 * Forget a user (a deleted account): the request is recorded first, then carried out. An
 * instance that will not stop leaves it pending — nothing erased yet — and the scheduled sweep
 * retries it; `erased: false` says so.
 */
export async function forgetUser(
  env: JourneyEnv,
  userId: string,
  store: JourneyStore = d1Store(env),
  now = Date.now()
): Promise<{ ok: true; erased: boolean; pending: string[] }> {
  await store.requestErasure(userId, now);
  return { ok: true, ...(await eraseUser(env, userId, store)) };
}

/**
 * The user signed out on the device: the token stays registered, bound to nobody, so the next
 * sign-in only has to bind it again. Wakes the former owner's device waits (`reachable('push')`
 * may no longer hold).
 */
export async function unbindDevice(
  env: JourneyEnv,
  token: string,
  store: JourneyStore = d1Store(env)
): Promise<{ ok: true; woke: number }> {
  const owner = await store.unbindDevice(token);
  const woke =
    owner === undefined ? 0 : await wakeSubscribers(env, store, owner, [DEVICES_UPDATED_EVENT]);
  return { ok: true, woke };
}

/** A push token forgotten for good (the push service reports it gone); wakes its owner's device waits. */
export async function removeDevice(
  env: JourneyEnv,
  token: string,
  store: JourneyStore = d1Store(env)
): Promise<{ ok: true; woke: number }> {
  const owner = await store.removeDevice(token);
  const woke =
    owner === undefined ? 0 : await wakeSubscribers(env, store, owner, [DEVICES_UPDATED_EVENT]);
  return { ok: true, woke };
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
  /**
   * Whether the routes now point at this bundle: always for a forced deploy, false for a
   * versioned one when a version as new or newer is already live (nothing was swapped).
   */
  applied: boolean;
}

/** A versioned deploy on a store that cannot tell which version is live (D1). */
export class UnversionedStoreError extends Error {
  override readonly name = 'UnversionedStoreError';
  constructor() {
    super('this store does not record which version is live: deploy with POST /bundle/deploy');
  }
}

/** A bundle whose declared hashes do not describe its contents — rejected before anything is written. */
export class BundleIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleIntegrityError';
  }
}

/**
 * Recompute every declared contentHash and refuse the bundle if one disagrees.
 *
 * The contentHash is the address an in-flight journey reads its IR from, so
 * a hash that does not describe its own content is a way to change what a
 * pinned instance executes: submit an edited flow under the old hash and the
 * next replay picks it up. The compiler always computes the hash it ships, so
 * a mismatch means a hand-rolled payload or a stale client — neither should be
 * able to overwrite a version that journeys are running.
 *
 * Each hash is recomputed exactly the way its compiler produced it: a workflow
 * hashes its whole IR (contentHash strips itself), a segment hashes only its
 * condition. Mirroring them is load-bearing — recomputing a segment over the
 * whole record would reject every honest deploy.
 */
function verifyBundleHashes(parsed: BundleIR): void {
  const mismatched: string[] = [];
  for (const workflow of parsed.workflows) {
    if (semanticHash(workflow) !== workflow.contentHash) {
      mismatched.push(`workflow '${workflow.id}'`);
    }
  }
  for (const segment of parsed.segments) {
    if (semanticHash(segment.condition) !== segment.contentHash) {
      mismatched.push(`segment '${segment.id}'`);
    }
  }
  if (mismatched.length > 0) {
    throw new BundleIntegrityError(
      `contentHash does not match content for ${mismatched.join(', ')} — recompile the bundle instead of editing it by hand`
    );
  }
}

/**
 * Bundle deploy, terraform-apply style: workflow bodies first (content-addressed, so a failed
 * deploy leaves only harmless orphans), then the routing swap. With a `version` the swap happens
 * only over an older live version (`replaceRoutesIfNewer`) — how journeyWorker applies the bundle
 * compiled into it; without one it is forced, whatever is live.
 */
export async function deployBundle(
  env: JourneyEnv,
  bundle: unknown,
  store: JourneyStore = d1Store(env),
  version?: BundleVersion
): Promise<DeployResult> {
  if (version !== undefined && store.replaceRoutesIfNewer === undefined) {
    throw new UnversionedStoreError();
  }
  const parsed = BundleIR.parse(bundle);
  // Before any write: a bad hash must not reach the store, where it would address content it does not describe
  verifyBundleHashes(parsed);
  // Nor a bundle the database cannot hold: the host migrates, the engine only checks
  const problems = (await store.checkSchema?.()) ?? [];
  if (problems.length > 0) throw new SchemaMismatchError(problems);

  for (const workflow of parsed.workflows) await store.putWorkflowIR(workflow);
  let applied = true;
  if (version === undefined) await store.replaceRoutes(parsed);
  else applied = (await store.replaceRoutesIfNewer?.(parsed, version)) ?? false;

  const unrouted = parsed.workflows
    .filter((workflow) => workflow.trigger.type === 'date' || workflow.trigger.type === 'webhook')
    .map((workflow) => ({ workflow: workflow.id, trigger: workflow.trigger.type }));

  return {
    workflows: parsed.workflows.map((w) => `${w.id}@${w.contentHash.slice(0, 8)}`),
    unrouted,
    applied,
  };
}

/* ----------------------------------- http ----------------------------------- */

/**
 * Request bodies are untrusted JSON. They are read as unknown fields and
 * checked, never cast into the shape they are supposed to have: a cast only
 * silences the compiler, and what arrives here reaches SQL parameters.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  return isPlainObject(body) ? body : {};
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A profile value: a scalar or null (which removes the property). Nested values are not profile data. */
function isScalarOrNull(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** How far ahead of the server's clock an event or device `ts` may be: clock skew, not the future. */
const TS_FUTURE_TOLERANCE_MS = 5 * 60_000;
const TS_ERROR = 'ts must be a non-negative integer no later than 5 minutes in the future';

/**
 * A caller's timestamp: epoch milliseconds, whole, not negative, and not past the skew tolerance.
 * A far-future ts would put the event ahead of everything a window condition reads, and a
 * fractional or unsafe one does not survive the store.
 */
function isValidTs(ts: unknown): ts is number {
  return (
    typeof ts === 'number' &&
    Number.isSafeInteger(ts) &&
    ts >= 0 &&
    ts <= Date.now() + TS_FUTURE_TOLERANCE_MS
  );
}

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

export async function handleRequest(
  request: Request,
  env: JourneyEnv,
  store: JourneyStore = d1Store(env),
  validation: IngestValidation = {}
): Promise<Response> {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const { contract } = validation;
  const enforce = validation.mode !== 'report';
  /** The contract's verdict: the value to use, or the response refusing the request. */
  const checked = <T>(
    result: ContractResult<T>,
    original: T,
    what: string
  ): { value: T } | { refused: Response } => {
    if (result.ok) return { value: result.data };
    const issues = result.issues.map((i) => `${i.path || '(root)'}: ${i.message}`);
    if (!enforce) {
      console.warn(`[workflow router] contract would refuse ${what}: ${issues.join('; ')}`);
      return { value: original };
    }
    return {
      refused: json({ error: `${what} refused by the contract`, issues: result.issues }, 400),
    };
  };

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true });
  }

  // Bearer auth on everything mutating. An unset token means an open dev
  // instance (see JourneyEnv.API_TOKEN) — production refuses to run without one (journey-host).
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try {
    if (request.method === 'POST' && url.pathname === '/events') {
      const { id, userId, event, payload, ts } = await readBody(request);
      if (!isNonEmptyString(userId) || !isNonEmptyString(event)) {
        return json({ error: 'userId and event required' }, 400);
      }
      if (event.startsWith('$')) {
        return json({ error: 'event names starting with $ are reserved' }, 400);
      }
      // An empty id is rejected rather than treated as absent: a caller that
      // sent one meant to identify the occurrence, and silently minting a
      // different one would turn their retry into a duplicate.
      if (id !== undefined && !isNonEmptyString(id)) {
        return json({ error: 'id must be a non-empty string' }, 400);
      }
      if (ts !== undefined && !isValidTs(ts)) return json({ error: TS_ERROR }, 400);
      if (payload !== undefined && !isPlainObject(payload)) {
        return json({ error: 'payload must be an object' }, 400);
      }
      let accepted = payload;
      if (contract !== undefined) {
        const verdict = checked(
          checkEvent(contract, event, payload ?? {}),
          accepted ?? {},
          `event '${event}'${typeof id === 'string' ? ` (${id})` : ''}`
        );
        if ('refused' in verdict) return verdict.refused;
        accepted = verdict.value;
      }
      return json(await ingestEvent(env, { id, userId, event, payload: accepted, ts }, store));
    }

    if (request.method === 'POST' && url.pathname === '/identify') {
      const { userId, props } = await readBody(request);
      if (!isNonEmptyString(userId)) return json({ error: 'userId required' }, 400);
      if (!isPlainObject(props)) return json({ error: 'props must be an object' }, 400);
      // Profiles hold scalars only (both stores merge at the top level; a nested object would
      // be merged differently by each): refused here, contract or not
      if (!Object.values(props).every(isScalarOrNull)) {
        return json(
          { error: 'props values must be scalars (string, number, boolean) or null' },
          400
        );
      }
      let patch = props as ProfileProps;
      if (contract !== undefined) {
        const verdict = checked(contract.parseProfilePatch(props), patch, 'identify');
        if ('refused' in verdict) return verdict.refused;
        patch = verdict.value as ProfileProps;
      }
      return json(await identifyUser(env, userId, patch, store));
    }

    if (request.method === 'POST' && url.pathname === '/devices') {
      const { userId, token, platform, ts } = await readBody(request);
      if (!isNonEmptyString(userId)) return json({ error: 'userId required' }, 400);
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
        return json({ error: "platform must be 'ios', 'android' or 'web'" }, 400);
      }
      if (ts !== undefined && !isValidTs(ts)) return json({ error: TS_ERROR }, 400);
      return json(
        await registerDevice(
          env,
          { userId, token, platform, ...(ts === undefined ? {} : { ts }) },
          store
        )
      );
    }

    if (request.method === 'POST' && url.pathname === '/messages/opened') {
      const { userId, messageId } = await readBody(request);
      if (!isNonEmptyString(userId)) return json({ error: 'userId required' }, 400);
      if (!isNonEmptyString(messageId)) return json({ error: 'messageId required' }, 400);
      const recorded =
        store.reporting !== undefined && (await recordPushOpen(store.reporting, userId, messageId));
      return json({ ok: true, recorded });
    }

    if (request.method === 'POST' && url.pathname === '/users/forget') {
      const { userId } = await readBody(request);
      if (!isNonEmptyString(userId)) return json({ error: 'userId required' }, 400);
      return json(await forgetUser(env, userId, store));
    }

    if (request.method === 'POST' && url.pathname === '/devices/unbind') {
      const { token } = await readBody(request);
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      return json(await unbindDevice(env, token, store));
    }

    if (request.method === 'POST' && url.pathname === '/devices/remove') {
      const { token } = await readBody(request);
      if (!isNonEmptyString(token)) return json({ error: 'token required' }, 400);
      return json(await removeDevice(env, token, store));
    }

    if (request.method === 'POST' && url.pathname === '/deploy') {
      return json(await deployBundle(env, await readJson(request), store));
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    // Validation problems are the caller's to fix; anything else stays out of
    // the response body (internals are logged, not leaked).
    if (error instanceof InvalidJsonError) {
      return json({ error: 'invalid JSON body' }, 400);
    }
    if (error instanceof z.core.$ZodError) {
      return json({ error: `invalid payload: ${error.message}` }, 400);
    }
    // The user is being erased: gone, and nothing about them is taken until the erase is through
    if (error instanceof UserErasedError) {
      return json({ error: 'user is being erased' }, 410);
    }
    // The caller sent a self-inconsistent bundle: their problem to fix, so say what is wrong
    if (error instanceof BundleIntegrityError) {
      return json({ error: error.message }, 400);
    }
    // The operator's to fix (run the migrations), so the response says what is missing
    if (error instanceof SchemaMismatchError) {
      return json({ error: error.message, problems: error.problems }, 503);
    }
    console.error('[workflow router]', error);
    return json({ error: 'internal error' }, 500);
  }
}
