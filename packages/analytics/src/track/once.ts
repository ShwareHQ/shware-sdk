import { v7 as uuidv7 } from 'uuid';
import { config } from '../setup/index';
import { type TrackOptions, queueEvent } from './index';
import type { EventName, TrackName, TrackProperties } from './types';

export interface TrackOnceOptions extends TrackOptions {
  /**
   * What makes this occurrence the same one again: a checkout session id for `purchase`, an order
   * id, a transaction id. Required, never derived from the properties, so the caller decides what
   * "once" means. The same key under another event name is a different occurrence.
   */
  key: string;
  /** How long a sent key is remembered, in milliseconds. 90 days by default. */
  ttl?: number;
}

const DEFAULT_TTL = 90 * 24 * 60 * 60 * 1000;
/** Keys remembered per event name; the oldest are forgotten first. */
const MAX_ENTRIES = 20;

/**
 * `{"v":1,"entries":[[key, expiresAt], …]}`, oldest first. Entries are tuples in an array rather
 * than an object keyed by `key`: an object would move integer-like keys ("123") to the front and
 * lose the order the oldest are dropped by. Escaping the value for the medium is the storage's
 * job, so this is plain JSON.
 */
const VERSION = 1;

type Entry = { key: string; expiresAt: number };

function storageKey(name: string) {
  return `track_once.${name}`;
}

/** The stored entries, or none for a record that is missing, of another version or malformed. */
function read(name: string): Entry[] {
  const raw = config.storage.getItem(storageKey(name));
  if (!raw) return [];
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof record !== 'object' || record === null) return [];
  const { v, entries } = record as { v?: unknown; entries?: unknown };
  if (v !== VERSION || !Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    if (!Array.isArray(entry)) return [];
    const [key, expiresAt] = entry as unknown[];
    if (typeof key !== 'string' || typeof expiresAt !== 'number') return [];
    return [{ key, expiresAt }];
  });
}

function write(name: string, entries: Entry[]) {
  const record = {
    v: VERSION,
    entries: entries.slice(-MAX_ENTRIES).map((entry) => [entry.key, entry.expiresAt]),
  };
  config.storage.setItem(storageKey(name), JSON.stringify(record));
}

function live(entries: Entry[], now: number) {
  return entries.filter((entry) => entry.expiresAt > now);
}

/**
 * The attempts made at a key not yet confirmed sent, with the event id each went out under:
 * `{"v":1,"entries":[[key, id, expiresAt], …]}` under `track_once_attempt.<event>`, oldest first.
 *
 * The third-party trackers are fired when an event is tracked, not when it is sent, so a send
 * that fails has already reported the occurrence to the pixels. The next attempt at the same key
 * — a reload of the result page, a sync run again — goes out under the same id and fires none
 * of them again: the pixels count the occurrence once, and the server, storing events
 * `on conflict (id) do nothing`, stores it once even if the failed send had in fact arrived.
 */
type Attempt = { key: string; id: string; expiresAt: number };

function attemptKey(name: string) {
  return `track_once_attempt.${name}`;
}

function readAttempts(name: string): Attempt[] {
  const raw = config.storage.getItem(attemptKey(name));
  if (!raw) return [];
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof record !== 'object' || record === null) return [];
  const { v, entries } = record as { v?: unknown; entries?: unknown };
  if (v !== VERSION || !Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    if (!Array.isArray(entry)) return [];
    const [key, id, expiresAt] = entry as unknown[];
    if (typeof key !== 'string' || typeof id !== 'string' || typeof expiresAt !== 'number') {
      return [];
    }
    return [{ key, id, expiresAt }];
  });
}

function writeAttempts(name: string, attempts: Attempt[]) {
  const record = {
    v: VERSION,
    entries: attempts.slice(-MAX_ENTRIES).map((a) => [a.key, a.id, a.expiresAt]),
  };
  config.storage.setItem(attemptKey(name), JSON.stringify(record));
}

/** Forgets the attempt at `key`, once it has been sent; only rewrites a record that holds it. */
function settleAttempt(name: string, key: string) {
  const attempts = readAttempts(name);
  if (!attempts.some((attempt) => attempt.key === key)) return;
  writeAttempts(
    name,
    attempts.filter((attempt) => attempt.key !== key && attempt.expiresAt > Date.now())
  );
}

/** Keys queued in this page (or app process) but not confirmed sent yet, per event name. */
const pending = new Map<string, Set<string>>();

function isPending(name: string, key: string) {
  return pending.get(name)?.has(key) ?? false;
}

function markPending(name: string, key: string) {
  const keys = pending.get(name);
  if (keys) keys.add(key);
  else pending.set(name, new Set([key]));
}

function clearPending(name: string, key: string) {
  const keys = pending.get(name);
  if (!keys) return;
  keys.delete(key);
  if (keys.size === 0) pending.delete(name);
}

/**
 * Tracks an event at most once per `key`: a reloaded or revisited payment result page, a
 * re-delivered store transaction, a confirmation screen opened twice. Returns whether the event
 * was queued.
 *
 * The key is remembered in `config.storage` only once the event has been sent (`onSucceed`), so a
 * send that fails is tried again by the next call instead of being lost; within one page a key
 * already queued is not queued twice. When the storage cannot be read or written the event is
 * tracked anyway: a rare duplicate is better than a lost conversion.
 *
 * The event's id is decided by the first attempt at a key and kept until the key is sent, so
 * the third-party trackers, fired when the event is tracked, are fired once per key even when the
 * first send fails and a later call sends it (see `Attempt`).
 *
 * Deduplication is per device and storage. A second device still reports its own occurrence, so
 * figures that must be exact (revenue) belong to server-side records.
 */
export function trackOnce<T extends EventName = EventName>(
  name: TrackName<T>,
  properties: TrackProperties<T> | undefined,
  { key, ttl = DEFAULT_TTL, ...options }: TrackOnceOptions
): boolean {
  if (isPending(name, key)) return false;

  const now = Date.now();
  try {
    if (live(read(name), now).some((entry) => entry.key === key)) return false;
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }

  // An earlier attempt that failed to send: its id, and its pixels already fired.
  let earlier: Attempt | undefined;
  let id: string | undefined;
  try {
    const attempts = readAttempts(name).filter((attempt) => attempt.expiresAt > now);
    earlier = attempts.find((attempt) => attempt.key === key);
    if (!earlier) {
      id = uuidv7();
      writeAttempts(name, [...attempts, { key, id, expiresAt: now + ttl }]);
    }
  } catch (e: unknown) {
    // Unrecorded, a failed send would fire the pixels again on the next attempt: a rare
    // duplicate there beats not tracking.
    if (e instanceof Error) console.log(e.message);
  }

  markPending(name, key);
  const callbacks: TrackOptions = {
    ...options,
    onSucceed: (response) => {
      clearPending(name, key);
      try {
        const entries = live(read(name), Date.now()).filter((entry) => entry.key !== key);
        write(name, [...entries, { key, expiresAt: Date.now() + ttl }]);
        settleAttempt(name, key);
      } catch (e: unknown) {
        if (e instanceof Error) console.log(e.message);
      }
      options.onSucceed?.(response);
    },
    onError: (error) => {
      // Not sent: forget it here so a later call can try again.
      clearPending(name, key);
      options.onError?.(error);
    },
  };
  queueEvent(name, properties, callbacks, earlier ? { id: earlier.id, pixels: false } : { id });
  return true;
}
