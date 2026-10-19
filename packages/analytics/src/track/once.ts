import { config } from '../setup/index';
import { type TrackOptions, track } from './index';
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
 * `<version>.<entry>~<entry>…`, each entry `<expiresAt base36>-<encoded key>`: compact and
 * cookie-safe like the session record (see `setup/session.ts`), since a host may hand
 * `setupAnalytics` a cookie-backed `storage`. Keys are percent-encoded with `~` escaped too
 * (`encodeURIComponent` leaves it as is), and the base36 time has no `-`, so a record splits on `~`
 * and an entry on its first dash.
 */
const VERSION = '1';

type Entry = { key: string; expiresAt: number };

function storageKey(name: string) {
  return `track_once.${name}`;
}

function read(name: string): Entry[] {
  const raw = config.storage.getItem(storageKey(name));
  if (!raw?.startsWith(`${VERSION}.`)) return [];
  return raw
    .slice(VERSION.length + 1)
    .split('~')
    .flatMap((part) => {
      const dash = part.indexOf('-');
      if (dash <= 0) return [];
      const expiresAt = Number.parseInt(part.slice(0, dash), 36);
      if (!Number.isFinite(expiresAt)) return [];
      try {
        return [{ key: decodeURIComponent(part.slice(dash + 1)), expiresAt }];
      } catch {
        return [];
      }
    });
}

function encodeKey(key: string) {
  return encodeURIComponent(key).replaceAll('~', '%7E');
}

function write(name: string, entries: Entry[]) {
  const record = entries
    .slice(-MAX_ENTRIES)
    .map((entry) => `${entry.expiresAt.toString(36)}-${encodeKey(entry.key)}`)
    .join('~');
  config.storage.setItem(storageKey(name), `${VERSION}.${record}`);
}

function live(entries: Entry[], now: number) {
  return entries.filter((entry) => entry.expiresAt > now);
}

/** Keys queued in this page (or app process) but not confirmed sent yet. */
const pending = new Set<string>();

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
 * Deduplication is per device and storage. A second device still reports its own occurrence, so
 * figures that must be exact (revenue) belong to server-side records.
 */
export function trackOnce<T extends EventName = EventName>(
  name: TrackName<T>,
  properties: TrackProperties<T> | undefined,
  { key, ttl = DEFAULT_TTL, ...options }: TrackOnceOptions
): boolean {
  const id = `${name}\u0000${key}`;
  if (pending.has(id)) return false;

  const now = Date.now();
  try {
    if (live(read(name), now).some((entry) => entry.key === key)) return false;
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }

  pending.add(id);
  track(name, properties, {
    ...options,
    onSucceed: (response) => {
      pending.delete(id);
      try {
        const entries = live(read(name), Date.now()).filter((entry) => entry.key !== key);
        write(name, [...entries, { key, expiresAt: Date.now() + ttl }]);
      } catch (e: unknown) {
        if (e instanceof Error) console.log(e.message);
      }
      options.onSucceed?.(response);
    },
    onError: (error) => {
      // Not sent: forget it here so a later call can try again.
      pending.delete(id);
      options.onError?.(error);
    },
  });
  return true;
}
