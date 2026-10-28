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
 * `{"v":2,"entries":[[key, id, expiresAt, sent], …]}`, oldest first. Entries are tuples in an
 * array rather than an object keyed by `key`: an object would move integer-like keys ("123") to
 * the front and lose the order the oldest are dropped by. Escaping the value for the medium is the
 * storage's job, so this is plain JSON.
 *
 * `id` is the event id the key goes out under, decided by the first call and kept while `sent`
 * is false — a send that failed, or a page reloaded before its batch went out. The third-party
 * trackers fire when the event is tracked, not when it is sent, so that first call has already
 * reported the occurrence to them: the next call reuses the id, fires none of them again, and
 * the server (`on conflict (id) do nothing`) stores the event once even if the failed send had in
 * fact arrived.
 *
 * Version 1 records (`[key, expiresAt]`, written before the id was kept) are read as sent: that
 * is all a v1 record ever held, and dropping them would report every remembered occurrence again.
 */
const VERSION = 2;

type Entry = { key: string; id: string; expiresAt: number; sent: boolean };

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
  if (!Array.isArray(entries)) return [];
  if (v === 1) {
    return entries.flatMap((entry: unknown) => {
      if (!Array.isArray(entry)) return [];
      const [key, expiresAt] = entry as unknown[];
      if (typeof key !== 'string' || typeof expiresAt !== 'number') return [];
      // Sent is all v1 remembered; the id it went out under is gone, and no longer needed.
      return [{ key, id: '', expiresAt, sent: true }];
    });
  }
  if (v !== VERSION) return [];
  return entries.flatMap((entry: unknown) => {
    if (!Array.isArray(entry)) return [];
    const [key, id, expiresAt, sent] = entry as unknown[];
    if (typeof key !== 'string' || typeof id !== 'string' || typeof expiresAt !== 'number') {
      return [];
    }
    if (typeof sent !== 'boolean') return [];
    return [{ key, id, expiresAt, sent }];
  });
}

function write(name: string, entries: Entry[]) {
  const record = {
    v: VERSION,
    entries: entries.slice(-MAX_ENTRIES).map((e) => [e.key, e.id, e.expiresAt, e.sent]),
  };
  config.storage.setItem(storageKey(name), JSON.stringify(record));
}

function live(entries: Entry[], now: number) {
  return entries.filter((entry) => entry.expiresAt > now);
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
 * The key is marked sent in `config.storage` only once the event has been sent (`onSucceed`), so a
 * send that fails is tried again by the next call instead of being lost — under the same event id,
 * so the third-party trackers fired by the first call are not fired again (see `VERSION`); within
 * one page a key already queued is not queued twice.
 *
 * An event that leaves by beacon (`sendPendingEvents`, the page hidden or left) is not marked
 * sent: a beacon cannot tell delivered from dropped, so it counts as unconfirmed and the entry
 * stays unsent with its id. The next call for the key — the result page opened again — sends the
 * event once more under that id and without pixels, which the server ignores when the beacon did
 * arrive (it drops an event id it already has): one idempotent request more, against a lost one. When the storage cannot be read or written
 * the event is tracked anyway: a rare duplicate is better than a lost conversion.
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
  // An earlier call that failed to send: its id, and its pixels already fired.
  let earlier: Entry | undefined;
  let id = uuidv7();
  try {
    const entries = live(read(name), now);
    earlier = entries.find((entry) => entry.key === key);
    if (earlier?.sent) return false;
    if (earlier) id = earlier.id;
    else write(name, [...entries, { key, id, expiresAt: now + ttl, sent: false }]);
  } catch (e: unknown) {
    // Unrecorded, a failed send would fire the pixels again on the next call: a rare duplicate
    // there beats not tracking.
    if (e instanceof Error) console.log(e.message);
  }

  markPending(name, key);
  queueEvent(
    name,
    properties,
    {
      ...options,
      onSucceed: (response) => {
        clearPending(name, key);
        // A beacon was only queued by the browser: the entry stays unsent, so a later call
        // sends it again under the same id.
        if (response?.beacon) {
          options.onSucceed?.(response);
          return;
        }
        try {
          const entries = live(read(name), Date.now()).filter((entry) => entry.key !== key);
          write(name, [...entries, { key, id, expiresAt: Date.now() + ttl, sent: true }]);
        } catch (e: unknown) {
          if (e instanceof Error) console.log(e.message);
        }
        options.onSucceed?.(response);
      },
      onError: (error) => {
        // Not sent: the entry stays unsent, with its id, so a later call can try again.
        clearPending(name, key);
        options.onError?.(error);
      },
    },
    earlier ? { id, pixels: false } : { id }
  );
  return true;
}
