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

/** A store plus how to release what opening it acquired (a connection, say). */
export interface StoreLease {
  store: JourneyStore;
  close?: () => Promise<void>;
}

export interface JourneyStore {
  /* ---------------------------------- events --------------------------------- */
  /** Append the occurrence; false when its id was already in the log (nothing written). */
  insertEvent(input: EventInput): Promise<boolean>;
  /** Occurrences of `event` for the user, optionally only those at or after `sinceMs`. */
  countEvents(userId: string, event: string, opts?: { sinceMs?: number }): Promise<number>;
  /** The payloads of those occurrences — the caller filters them with the shared evaluator. */
  listEventPayloads(
    userId: string,
    event: string,
    opts?: { sinceMs?: number }
  ): Promise<Record<string, unknown>[]>;

  /* --------------------------------- profiles -------------------------------- */
  getProfile(userId: string): Promise<ProfileProps | undefined>;
  /**
   * Merge-patch `props` into the stored profile in one statement (a null
   * removes the property) and return the result. One statement, because a
   * read-modify-write loses one of two concurrent identifies.
   */
  mergeProfile(userId: string, props: ProfileProps): Promise<ProfileProps>;

  /* ---------------------------- deployed definitions -------------------------- */
  getSegmentCondition(name: string): Promise<ConditionIR | undefined>;
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

  /* ----------------------------- segment membership --------------------------- */
  isSegmentMember(segment: string, userId: string): Promise<boolean>;
  addSegmentMember(segment: string, userId: string, ts: number): Promise<void>;
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
export type { PostgresJourneyStoreOptions, SqlClientLike } from './postgres';
