import type { PushDevice } from '../engine/ports';
import type { BundleIR, ConditionIR, ScalarIR, WorkflowIR } from '../ir';

/**
 * The journey engine's data plane as a port. Everything the ingest router, the
 * runner and the fact source persist or look up goes through this interface,
 * so the storage engine is a deployment choice: D1 + KV (`D1JourneyStore`,
 * the original), Postgres (`PostgresJourneyStore`), or anything else that can
 * satisfy the contract below. Execution (durable steps, sleeps, wake-ups) is
 * the workflow runtime's job and stays out of here.
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
}

export interface SegmentTriggerRoute {
  workflow: string;
  hash: string;
  segment: string;
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

/** A store plus how to release what opening it acquired (a connection, say). */
export interface StoreLease {
  store: JourneyStore;
  close?: () => Promise<void>;
}

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
 * sizes. A store that keeps it (Postgres) exposes it as `reporting`; the Worker then records it
 * and serves email tracking. Every write is idempotent — a retried step reports again.
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
  /** The email copy's recipient opted out of email: recorded on the copy and as a suppression. False for an unknown copy. */
  recordUnsubscribe(messageId: string, at: number): Promise<boolean>;
  /** A push copy the device reported it received. False for an unknown copy. */
  recordDeviceDelivered(messageId: string, at: number): Promise<boolean>;
  /** Drop members of segments no longer deployed, then record every deployed segment's size. */
  snapshotSegments(at: number): Promise<{ segment: string; size: number }[]>;
}

export interface JourneyStore {
  /** Reporting, when the store keeps it (Postgres); D1 stores none. */
  readonly reporting?: JourneyReporting;

  /**
   * Record that the user's data must go (a deleted account), before anything is erased: the
   * request outlives a failure to stop their instances, and the sweep retries it.
   */
  requestErasure(userId: string, at: number): Promise<void>;
  /** Users whose erasure was requested and not finished yet. */
  pendingErasures(): Promise<string[]>;
  /** The user's journey instances still running, by the entry ledger. */
  runningInstances(userId: string): Promise<string[]>;
  /**
   * Erase everything kept about the user — profile, devices, events, wake subscriptions, segment
   * memberships, suppressions, entries and reporting — and the erasure request last. Run only
   * once no instance of theirs runs any more, or one could write some of it back.
   */
  forgetUser(userId: string): Promise<void>;

  /** The user opted out of the channel (recorded by an unsubscribe); stores without reporting omit it. */
  isSuppressed?(userId: string, channel: string): Promise<boolean>;

  /**
   * What the live database lacks against the engine's tables (read-only); a deploy refuses to
   * run while it lists anything. Stores whose schema the engine owns (D1) omit it.
   */
  checkSchema?(): Promise<string[]>;

  /* ---------------------------------- events --------------------------------- */
  /** Append the occurrence; false when its id was already in the log (nothing written). */
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

  /** Every user the engine knows (a profile or an event): who the segment sweep evaluates. */
  listUserIds(): Promise<string[]>;

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
   * not a cache in front of it. Stores without it (D1) leave every deploy to `POST /bundle/deploy`.
   */
  liveBundleVersion?(): Promise<BundleVersion | undefined>;
  /**
   * `replaceRoutes`, only when `version` is newer than the live one, recorded in the same
   * transaction: two versions serving side by side during a rollout cannot leave the older one's
   * routes in force. False, with nothing written, when a version as new or newer is live.
   */
  replaceRoutesIfNewer?(bundle: BundleIR, version: BundleVersion): Promise<boolean>;

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

  /* ------------------------------ wake subscriptions --------------------------- */
  /** Distinct wake handles registered for (user, event). */
  findWakeHandles(userId: string, event: string): Promise<string[]>;
  /** Register the handle for each event; repeated registrations are idempotent. */
  subscribe(handle: string, userId: string, events: readonly string[], ts: number): Promise<void>;
  /** Drop every registration the handle holds. */
  unsubscribe(handle: string): Promise<void>;
}

export { D1JourneyStore } from './d1';
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
