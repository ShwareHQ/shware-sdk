import { checkEvent } from '../contract';
import {
  type JourneyStore,
  type ProfileProps,
  UserErasedError,
  isVisitorSubject,
} from '../store/index';
import type { IngestValidation } from './http';
import {
  type IdentifyResult,
  type IngestResult,
  identifyUser,
  ingestEvent,
  linkVisitor,
} from './ingest';
import type { JourneyEnv } from './platform';

/**
 * One producer report as a single unit: what the user's profile now says and what they just did.
 * The profile is merged before the first event, so a journey an event starts always finds the
 * recipient that report knew about, whichever transport carried it and whatever arrived around
 * it. The same shape travels over HTTP (`POST /ingest`) and through a queue.
 */
export interface JourneyBatch {
  /** The signed-in user. With `visitorId` too, that visitor is this user: they merge, once. */
  userId?: string | undefined;
  /** The visitor before sign-in: a stable id for one client, renewed when a user signs out. */
  visitorId?: string | undefined;
  profile?: ProfileProps | undefined;
  /**
   * When the profile was read (epoch ms), the Worker's clock when omitted. A property written
   * later stays: a redelivered batch cannot put an old address back.
   */
  at?: number | undefined;
  events?: readonly BatchEvent[] | undefined;
}

export interface BatchEvent {
  event: string;
  payload?: Record<string, unknown> | undefined;
  /** The occurrence's identity: a redelivered batch records it once. */
  id?: string | undefined;
  ts?: number | undefined;
}

export interface BatchResult {
  profile?: IdentifyResult;
  events: IngestResult[];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A profile value: a scalar or null (which removes the property). Nested values are not profile data. */
export function isScalarOrNull(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** How far ahead of the server's clock an event or device `ts` may be: clock skew, not the future. */
const TS_FUTURE_TOLERANCE_MS = 5 * 60_000;
export const TS_ERROR = 'ts must be a non-negative integer no later than 5 minutes in the future';

/**
 * A caller's timestamp: epoch milliseconds, whole, not negative, and not past the skew tolerance.
 * A far-future ts would put the event ahead of everything a window condition reads, and a
 * fractional or unsafe one does not survive the store.
 */
export function isValidTs(ts: unknown): ts is number {
  return (
    typeof ts === 'number' &&
    Number.isSafeInteger(ts) &&
    ts >= 0 &&
    ts <= Date.now() + TS_FUTURE_TOLERANCE_MS
  );
}

/** What is wrong with an untrusted identity: at least one id, and a user id outside the visitors' prefix. */
export function identityError(userId: unknown, visitorId: unknown): string | undefined {
  if (userId === undefined && visitorId === undefined) return 'userId or visitorId required';
  if (userId !== undefined && !isNonEmptyString(userId)) {
    return 'userId must be a non-empty string';
  }
  if (typeof userId === 'string' && isVisitorSubject(userId)) {
    return "userId must not start with 'visitor:'";
  }
  if (visitorId !== undefined && !isNonEmptyString(visitorId)) {
    return 'visitorId must be a non-empty string';
  }
  return undefined;
}

export type ParsedBatch =
  | { ok: true; batch: JourneyBatch }
  | { ok: false; error: string; issues?: readonly { path: string; message: string }[] };

/**
 * An untrusted batch, checked whole: one bad part refuses all of it, so a producer never has half
 * a report applied. Contract `mode: 'report'` logs what it would refuse and keeps the original.
 */
export function parseBatch(raw: unknown, validation: IngestValidation): ParsedBatch {
  const refuse = (error: string): ParsedBatch => ({ ok: false, error });
  if (!isPlainObject(raw)) return refuse('batch must be an object');
  const { userId, visitorId, profile, at, events } = raw;
  const identity = identityError(userId, visitorId);
  if (identity !== undefined) return refuse(identity);
  if (at !== undefined && !isValidTs(at)) return refuse(`at: ${TS_ERROR}`);
  if (profile === undefined && events === undefined) return refuse('profile or events required');

  const batch: JourneyBatch = {
    ...(userId === undefined ? {} : { userId: userId as string }),
    ...(visitorId === undefined ? {} : { visitorId: visitorId as string }),
    ...(at === undefined ? {} : { at }),
  };
  const contract = validation.contract;
  const report = (what: string, issues: readonly { path: string; message: string }[]) =>
    console.warn(
      `[workflow] contract would refuse ${what}: ${issues
        .map((i) => `${i.path || '(root)'}: ${i.message}`)
        .join('; ')}`
    );

  if (profile !== undefined) {
    if (!isPlainObject(profile)) return refuse('profile must be an object');
    if (!Object.values(profile).every(isScalarOrNull)) {
      return refuse('profile values must be scalars (string, number, boolean) or null');
    }
    batch.profile = profile as ProfileProps;
    if (contract !== undefined) {
      const result = contract.parseProfilePatch(profile);
      if (result.ok) batch.profile = result.data as ProfileProps;
      else if (validation.mode === 'report') report('the profile', result.issues);
      else return { ok: false, error: 'profile refused by the contract', issues: result.issues };
    }
  }

  if (events !== undefined) {
    if (!Array.isArray(events)) return refuse('events must be an array');
    const parsed: BatchEvent[] = [];
    for (const item of events as unknown[]) {
      if (!isPlainObject(item)) return refuse('every event must be an object');
      const { event, payload, id, ts } = item;
      if (!isNonEmptyString(event)) return refuse('every event needs a name');
      if (event.startsWith('$')) return refuse('event names starting with $ are reserved');
      if (id !== undefined && !isNonEmptyString(id)) {
        return refuse('an event id must be a non-empty string');
      }
      if (ts !== undefined && !isValidTs(ts)) return refuse(TS_ERROR);
      if (payload !== undefined && !isPlainObject(payload)) {
        return refuse('payload must be an object');
      }
      let accepted = payload;
      if (contract !== undefined) {
        const result = checkEvent(contract, event, payload ?? {});
        const what = `event '${event}'${id === undefined ? '' : ` (${id})`}`;
        if (result.ok) accepted = result.data;
        else if (validation.mode === 'report') report(what, result.issues);
        else return { ok: false, error: `${what} refused by the contract`, issues: result.issues };
      }
      parsed.push({ event, payload: accepted, id, ts });
    }
    batch.events = parsed;
  }
  return { ok: true, batch };
}

/**
 * Apply a checked batch: the visitor's merge, the profile, then each event in order. Every part is idempotent (a
 * property older than the stored one is skipped, an event id is stored once), so a caller retries
 * a failed batch whole.
 */
export async function ingestBatch(
  env: JourneyEnv,
  batch: JourneyBatch,
  store: JourneyStore
): Promise<BatchResult> {
  const { userId, visitorId, profile, at, events = [] } = batch;
  if (userId !== undefined && visitorId !== undefined) {
    await linkVisitor(env, visitorId, userId, store, at);
  }
  // A late report of a visitor who has signed in since reaches the user
  const subject = userId ?? (await store.touchVisitor(visitorId ?? '', at ?? Date.now()));
  const result: BatchResult = { events: [] };
  if (profile !== undefined) result.profile = await identifyUser(env, subject, profile, store, at);
  for (const { event, payload, id, ts } of events) {
    result.events.push(await ingestEvent(env, { userId: subject, event, payload, id, ts }, store));
  }
  return result;
}

/** A delivered queue message (the subset of the Cloudflare Queues `Message` used). */
export interface QueueMessageLike {
  id: string;
  body: unknown;
  /** Delivery attempts so far, this one included. */
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/** First retry after 30 s, doubling up to 15 minutes. */
function retryDelay(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(attempts - 1, 0), 900);
}

/**
 * Consume delivered batches one at a time. A batch that can never succeed is acknowledged, not
 * retried: one the contract refuses (logged with the field paths, never the payload) and one for
 * an erased user. Anything else is retried with a backoff until the queue's `max_retries` hands
 * it to its dead letter queue.
 */
export async function consumeBatches(
  env: JourneyEnv,
  messages: readonly QueueMessageLike[],
  store: JourneyStore,
  validation: IngestValidation
): Promise<void> {
  for (const message of messages) {
    const parsed = parseBatch(message.body, validation);
    if (!parsed.ok) {
      const issues = parsed.issues?.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ');
      console.error(
        `[workflow queue] batch ${message.id} refused: ${parsed.error}${issues ? ` (${issues})` : ''}`
      );
      message.ack();
      continue;
    }
    try {
      await ingestBatch(env, parsed.batch, store);
      message.ack();
    } catch (error) {
      if (error instanceof UserErasedError) {
        message.ack();
        continue;
      }
      console.error(`[workflow queue] batch ${message.id} failed`, error);
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}
