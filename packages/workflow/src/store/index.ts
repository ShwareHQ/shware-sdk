import type { PushDevice } from '../engine/ports';
import type { BundleIR, ConditionIR, ScalarIR, WorkflowIR } from '../ir';

/**
 * The journey engine's data plane. Postgres is the store (`PostgresJourneyStore`); this
 * interface is the port the host, the runner and the fact source use to persist or look
 * anything up, and what a test stub implements in its place. Execution (durable steps,
 * sleeps, wake-ups) is the workflow runtime's job and stays out of here.
 *
 * Timestamps are epoch milliseconds throughout; a store may persist them in
 * its native type as long as `sinceMs` comparisons behave.
 */

/**
 * A profile patch or a stored profile. On the way in, `null` means "remove
 * this property" (RFC 7386 merge-patch, the only way the API has to unset
 * one); a stored profile never contains null.
 */
export type ProfileProps = Record<string, ScalarIR | null | undefined>;

export interface EventInput {
  /** The occurrence's identity, chosen by the sender; a second insert with the same id is a no-op. */
  id: string;
  userId: string;
  event: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface TriggerRoute {
  workflow: string;
  hash: string;
  /** Payload gate (payload-only condition tree), or null when the trigger has none. */
  where: ConditionIR | null;
  /** Profile gate, or null. */
  filter: ConditionIR | null;
  /**
   * The code version that applied these routes (`replaceRoutesIfNewer`); absent after a forced
   * deploy. Read in the same row as the hash, so the pair is always one deploy's.
   */
  version?: string | undefined;
}

export interface SegmentTriggerRoute {
  workflow: string;
  hash: string;
  segment: string;
  /** As `TriggerRoute.version`. */
  version?: string | undefined;
}

/**
 * A Worker version, as Cloudflare's version metadata binding names it: the bundle compiled into
 * that version goes live only over an older one (`replaceRoutesIfNewer`).
 */
export interface BundleVersion {
  id: string;
  /** When the version was created (epoch ms): later versions are newer. */
  createdAt: number;
}

export interface EntryInput {
  workflow: string;
  userId: string;
  instanceId: string;
  hash: string;
  ts: number;
  /**
   * The instance's start, recorded in the same transaction as the entry — for a runtime whose
   * start is an asynchronous submit (AWS) that may have to be retried.
   */
  execution?: ExecutionStart | undefined;
}

/** How an instance is started on a runtime that submits it: replayed as is on every retry. */
export interface ExecutionStart {
  /** The runtime's idempotency key (the durable execution name). */
  name: string;
  /** What is invoked: a qualified function ARN, its version included. */
  target: string;
  /** The exact payload: a retried submit must send the same bytes, or the runtime refuses it. */
  input: string;
}

export interface ExecutionRecord extends ExecutionStart {
  instanceId: string;
  workflow: string;
  userId: string;
  createdAt: number;
  submittedAt?: number | undefined;
  arn?: string | undefined;
  unresolvedAt?: number | undefined;
  callbackId?: string | undefined;
  /** Bumped by every wait the instance arms: a wake or a cleanup of an older one leaves it alone. */
  generation: number;
  deadlineAt?: number | undefined;
  checkedAt?: number | undefined;
  stoppedAt?: number | undefined;
}

/**
 * What a runtime that submits its starts and parks waits on one-shot callbacks (AWS) keeps
 * beside the entry ledger. The runtime holds the execution history; this holds only the
 * mapping from the engine's instance id to it.
 */
export interface ExecutionRegistry {
  get(instanceId: string): Promise<ExecutionRecord | undefined>;
  /**
   * Starts not yet confirmed and not given up on, oldest first: of one (workflow, user) entry
   * still running, or every one created before `createdBefore`.
   */
  pendingStarts(filter: {
    workflow?: string;
    userId?: string;
    createdBefore?: number;
    limit: number;
  }): Promise<ExecutionRecord[]>;
  markSubmitted(instanceId: string, arn: string | undefined, at: number): Promise<void>;
  markUnresolved(instanceId: string, at: number): Promise<void>;
  setArn(instanceId: string, arn: string): Promise<void>;
  /** Record the callback a wait parks on; false when a newer generation is already armed. */
  armCallback(
    instanceId: string,
    callback: { id: string; generation: number; deadlineAt?: number | undefined }
  ): Promise<boolean>;
  /** Forget the callback — only if it is still that generation's. */
  clearCallback(instanceId: string, generation: number): Promise<void>;
  /** Submitted executions whose entry is still running, least recently checked first. */
  toReconcile(limit: number, checkedBefore: number): Promise<ExecutionRecord[]>;
  markChecked(instanceId: string, at: number): Promise<void>;
  /** Record the first stop; a later one keeps it. */
  markStopped(instanceId: string, at: number): Promise<void>;
}

/**
 * How an entry attempt ended: a fresh row, a 'failed' row of a dead instance
 * taken over (the once policy does not bar a user over one outage), or
 * refused because the pair already entered and is still alive.
 */
export type EntryOutcome = 'entered' | 'reclaimed' | null;

/** A device registered for pushes: its provider token belongs to the user who registered it last. */
export interface DeviceInput {
  userId: string;
  token: string;
  /** `ios` (APNs) or `android` (FCM): which provider the token belongs to. */
  platform: string;
  ts: number;
}

/** An instance of a user still in the ledger, and whether its runner was admitted (see `admitInstance`). */
export interface RunningInstance {
  instanceId: string;
  /** False until the runner admitted itself: nothing has run, and the tombstone keeps it that way. */
  admitted: boolean;
}

/** A store plus how to release what opening it acquired (a connection, say). */
export interface StoreLease {
  store: JourneyStore;
  close?: () => Promise<void>;
}

import type { ErasureState } from './erasure';

export { type ErasureState, UserErasedError } from './erasure';

/**
 * The live database lacks tables or columns the engine reads (an SDK upgrade added them, or the
 * host never ran the migration). Raised before a deploy writes anything.
 */
export class SchemaMismatchError extends Error {
  override readonly name = 'SchemaMismatchError';

  constructor(readonly problems: readonly string[]) {
    super(
      `the database does not match @shware/workflow's tables — regenerate the drizzle schema (workflow-ui generate) and run your migrations:\n  ${problems.join('\n  ')}`
    );
  }
}

/** A message copy as reporting records it, before it goes out. */
export interface MessageRecord {
  idempotencyKey: string;
  workflow: string;
  instanceId: string;
  nodeId: string;
  template: string;
  /** Where the copy lands: `email`, `push_ios`, `push_android`. */
  channel: string;
  userId: string;
  sentAt: number;
}

/** What a click is judged by. */
export interface ClickContext {
  url: string;
  deliveredAt: number;
  linkCount: number;
  /** The copy's clicks in the window before this one. */
  recent: { position: number; at: number }[];
}

/** An open or a click, with the verdict on who made it and where it came from. */
export interface Engagement {
  at: number;
  machine: boolean;
  /** The rule that called it a machine; null for a person. */
  reason: string | null;
  userAgent: string | null;
  /** The network the request came from (Cloudflare's `cf.asn`, `cf.asOrganization`, `cf.country`), never the address. */
  asn: number | null;
  organization: string | null;
  country: string | null;
}

/**
 * Journey reporting: where each instance stands, every copy and how it was engaged with, segment
 * sizes. The store exposes it as `reporting`; the host records it and serves email tracking.
 * Every write is idempotent — a retried step reports again.
 */
/** Bounds on when an event happened, both inclusive (epoch ms); an absent side is open. */
export interface EventWindow {
  sinceMs?: number;
  untilMs?: number;
}

export interface JourneyReporting {
  /** The instance entered: its row exists from here, so one a guard ends at once still counts. */
  instanceStarted(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    at: number;
  }): Promise<void>;
  nodeReached(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    nodeId: string;
    at: number;
  }): Promise<void>;
  instanceFinished(input: {
    workflow: string;
    instanceId: string;
    userId: string;
    status: string;
    at: number;
    convertedAt?: number;
  }): Promise<void>;
  /** The copy's row id; the row a retry already wrote, when there is one. */
  recordMessage(message: MessageRecord): Promise<string>;
  settleMessage(
    idempotencyKey: string,
    result: { delivered: true } | { delivered: false; reason: string },
    at: number
  ): Promise<void>;
  /** An email's tracked links, in document order. */
  recordLinks(messageId: string, urls: readonly string[]): Promise<void>;
  /**
   * Record an open of the copy, judged by `judge` against the copy (its recipient and when it was
   * delivered — when it was sent, before the transport answered); `undefined` from the judge
   * records nothing. Read and written in one transaction. False for an unknown copy.
   */
  recordOpen(
    messageId: string,
    judge: (message: { userId: string; deliveredAt: number }) => Engagement | undefined
  ): Promise<boolean>;
  /**
   * Record a click on the copy's link at `position`, judged by `judge` against the link, how
   * many links the copy has and its clicks of the last `windowMs`. The copy is locked for the
   * transaction, so clicks arriving together (a scanner following every link at once) are
   * judged one after another, each seeing the ones before. When the judge asks to `backdate`,
   * the window's earlier clicks are reclassified with this one's verdict. A click implies an
   * open. Undefined for an unknown link.
   */
  recordClick(
    messageId: string,
    position: number,
    at: number,
    windowMs: number,
    judge: (link: ClickContext) => { engagement: Engagement; backdate: boolean }
  ): Promise<{ url: string; engagement: Engagement } | undefined>;
  /**
   * The email copy's recipient opted out of email: recorded on the copy and as a suppression, in
   * one transaction, which also yields who the recipient is — so the caller acts on the
   * unsubscribe without a second read. Undefined for an unknown copy.
   */
  recordUnsubscribe(messageId: string, at: number): Promise<{ userId: string } | undefined>;
  /** A push copy the device reported it received. False for an unknown copy. */
  recordDeviceDelivered(messageId: string, at: number): Promise<boolean>;
  /** Drop members of segments no longer deployed, then record every deployed segment's size. */
  snapshotSegments(at: number): Promise<{ segment: string; size: number }[]>;
}

export interface JourneyStore {
  /** Where instances stand, every copy and its engagement, segment sizes. */
  readonly reporting: JourneyReporting;

  /**
   * Record that the user's data must go (a deleted account): the tombstone every write about
   * the user is conditional on, from here on and for good. Committed before anything is
   * stopped or erased, so an entry that got in before it is found by the erasure and none gets
   * in after it. Idempotent: a second request, or one for a user already erased, changes nothing.
   */
  requestErasure(userId: string, at: number): Promise<void>;
  /** Users whose erasure was requested and not carried out yet (`'erasing'`), oldest first. */
  pendingErasures(): Promise<string[]>;
  /**
   * Where the user stands: `'none'` (no tombstone), `'erasing'` (requested, their instances
   * being stopped, data still there) or `'erased'` (`forgetUser` went through). Both
   * tombstone states refuse every write about the user; the entry points read this for a fast
   * answer, and the store's conditional writes are the gate itself.
   */
  erasureState(userId: string): Promise<ErasureState>;
  /** The user's journey instances still running, by the entry ledger. */
  runningInstances(userId: string): Promise<RunningInstance[]>;
  /**
   * The runner's admission, before its first observable effect: records that the instance runs
   * (`admitted_at`, kept on replay) — unless the user has an erasure tombstone, in which case
   * nothing is recorded and the runner must not run. Mutually exclusive with `requestErasure`
   * and `forgetUser` for that user (Postgres: the user's advisory lock), so an erasure either
   * finds the instance admitted and stops it, or commits its tombstone first and the admission
   * is refused — never neither.
   *
   * A first admission needs the entry running. An instance already admitted is admitted again
   * whatever the entry's status — the legitimate replay of an instance whose finalisation was
   * cut short after the entry reached its terminal status, which resumes on its own checkpoint
   * and finishes what is left. Never a new attempt's way in: false for a terminal entry never
   * admitted, for an entry no longer in the ledger, for another user's entry, and for an
   * instance whose entry was reclaimed since (`enterJourney` resets the admission with the
   * instance id, so a superseded attempt cannot pass under the id it lost).
   */
  admitInstance(instanceId: string, userId: string): Promise<boolean>;
  /**
   * Erase everything kept about the user — profile, devices, events, wake subscriptions, segment
   * memberships, entries and reporting — and mark the tombstone erased (`erased_at`), which
   * stays: a write that was in flight when the data went cannot bring the user back, and the
   * same id is never reactivated by ingest. Suppressions stay too: an opt-out is a compliance
   * record keyed by an opaque id, and it outlives the erasure. Run only once no instance of
   * theirs runs any more, or one could write some of it back. Idempotent. Mutually exclusive
   * with every write about the user (the user's advisory lock), so
   * the data is gone when this returns — nothing of theirs lands afterwards.
   */
  forgetUser(userId: string, at: number): Promise<void>;

  /** The user opted out of the channel (recorded by an unsubscribe). */
  isSuppressed(userId: string, channel: string): Promise<boolean>;

  /**
   * What the live database lacks against the engine's tables (read-only); a deploy refuses to
   * run while it lists anything.
   */
  checkSchema(): Promise<string[]>;

  /* ---------------------------------- events --------------------------------- */
  /**
   * Append the occurrence; false when its id was already in the log (nothing written). Throws
   * `UserErasedError` for a user with a tombstone, like every write about a user below.
   */
  insertEvent(input: EventInput): Promise<boolean>;
  /** Occurrences of `event` for the user, optionally only those within the window. */
  countEvents(userId: string, event: string, window?: EventWindow): Promise<number>;
  /** The payloads of those occurrences — the caller filters them with the shared evaluator. */
  listEventPayloads(
    userId: string,
    event: string,
    window?: EventWindow
  ): Promise<Record<string, unknown>[]>;

  /* --------------------------------- profiles -------------------------------- */
  getProfile(userId: string): Promise<ProfileProps | undefined>;
  /**
   * Merge-patch `props` into the stored profile in one statement (a null
   * removes the property) and return the result. One statement, because a
   * read-modify-write loses one of two concurrent identifies.
   */
  mergeProfile(userId: string, props: ProfileProps): Promise<ProfileProps>;

  /**
   * Every user the engine knows (a profile or an event): who the segment sweep evaluates. Ids
   * come in ascending order; `after` resumes past the last id of the previous page, and `limit`
   * bounds the page (the whole list without one).
   */
  listUserIds(page?: { after?: string | undefined; limit?: number | undefined }): Promise<string[]>;

  /* ---------------------------------- devices --------------------------------- */
  /** The user's push devices, most recently registered first. */
  listDevices(userId: string): Promise<PushDevice[]>;
  /**
   * Register a device: one row per token, so a token registered again moves to the user who
   * registered it last (a phone signed into another account) and to the front of their list.
   */
  upsertDevice(device: DeviceInput): Promise<void>;
  /** Forget a token (reported dead by APNs / FCM); the user it belonged to, if any. */
  removeDevice(token: string): Promise<string | undefined>;
  /**
   * The user signed out on the device: the token is kept, bound to nobody, until the next sign-in
   * binds it again. The user it belonged to, if any.
   */
  unbindDevice(token: string): Promise<string | undefined>;

  /* ---------------------------- deployed definitions -------------------------- */
  getSegmentCondition(id: string): Promise<ConditionIR | undefined>;
  /** Every deployed segment with its definition: what the segment sweep evaluates. */
  listSegments(): Promise<{ id: string; condition: ConditionIR }[]>;
  findTriggers(event: string): Promise<TriggerRoute[]>;
  listSegmentTriggers(): Promise<SegmentTriggerRoute[]>;
  putWorkflowIR(workflow: WorkflowIR): Promise<void>;
  getWorkflowIR(contentHash: string): Promise<WorkflowIR | undefined>;
  /**
   * Swap the routing tables (segments, event triggers, segment triggers) for
   * the bundle's — atomically, so a concurrent ingest never sees them half
   * empty. Workflow bodies are stored separately (`putWorkflowIR`) because they
   * are content-addressed and outlive the routes that point at them.
   */
  replaceRoutes(bundle: BundleIR): Promise<void>;
  /**
   * The Worker version whose bundle the routes came from, when one put them there through
   * `replaceRoutesIfNewer` (a forced deploy leaves it as it was). Read from the database itself,
   * not a cache in front of it.
   */
  liveBundleVersion(): Promise<BundleVersion | undefined>;
  /**
   * `replaceRoutes`, only when `version` is newer than the live one, recorded in the same
   * transaction: two versions serving side by side during a rollout cannot leave the older one's
   * routes in force. False, with nothing written, when a version as new or newer is live.
   */
  replaceRoutesIfNewer(bundle: BundleIR, version: BundleVersion): Promise<boolean>;

  /* ----------------------------- segment membership --------------------------- */
  isSegmentMember(segment: string, userId: string): Promise<boolean>;
  /** Record the membership, with the workflows its entry has to start (see segment_start). */
  addSegmentMember(
    segment: string,
    userId: string,
    ts: number,
    workflows: readonly string[]
  ): Promise<void>;
  /** The workflows the member's entry has not started yet. */
  pendingSegmentStarts(segment: string, userId: string): Promise<string[]>;
  completeSegmentStart(segment: string, userId: string, workflow: string): Promise<void>;
  /** Drop the membership and any start it still owed. */
  removeSegmentMember(segment: string, userId: string): Promise<void>;

  /* ------------------------------- entry ledger ------------------------------- */
  /**
   * Record the entry (the once policy). Atomic under concurrent ingests: of
   * two racing attempts exactly one is 'entered' (or 'reclaimed', when the
   * pair's previous instance is recorded as 'failed') and the other null.
   */
  enterJourney(entry: EntryInput): Promise<EntryOutcome>;
  removeEntry(instanceId: string): Promise<void>;
  setEntryStatus(instanceId: string, status: string): Promise<void>;
  /** Execution starts and wake callbacks, for a runtime that submits its starts (AWS). */
  readonly executions: ExecutionRegistry;

  /* ------------------------------ wake subscriptions --------------------------- */
  /** Distinct wake handles registered for (user, event). */
  findWakeHandles(userId: string, event: string): Promise<string[]>;
  /** Register the handle for each event; repeated registrations are idempotent. */
  subscribe(handle: string, userId: string, events: readonly string[], ts: number): Promise<void>;
  /** Drop every registration the handle holds. */
  unsubscribe(handle: string): Promise<void>;
}

export { JourneyFactSource } from './facts';
export { PostgresJourneyStore } from './postgres';
export { PostgresReporting } from './postgres-reporting';
export {
  DEFAULT_SCHEMA,
  TABLES,
  renderDrizzleSchema,
  renderPostgresDdl,
  type TableSpec,
} from './tables';
export type { PostgresJourneyStoreOptions, SqlClientLike } from './postgres';
