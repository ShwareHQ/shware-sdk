import { TokenBucket, fetch } from '@shware/utils';
import { keys } from '../constants/storage';
import type { CreateTrackEventDTO } from '../schema/index';
import { cache, config } from '../setup/index';
import { getSession } from '../setup/session';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { getVisitor } from '../visitor/index';
import type { EventName, TrackEventResponse, TrackName, TrackProperties, TrackTags } from './types';

export interface TrackOptions {
  enableThirdPartyTracking?: boolean;
  onSucceed?: (response?: TrackEventResponse[number]) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = {};

let tokenBucket: TokenBucket | undefined;

/**
 * The rate limiter, built on the first send rather than at module scope: its
 * constructor starts a refill `setInterval`, and Cloudflare Workers refuse to
 * set a timer outside a request handler for the same reason they refuse to
 * generate random values there — see `setup/session.ts`.
 */
function getTokenBucket() {
  return (tokenBucket ??= new TokenBucket({ rate: 1, capacity: 20, requested: 2 }));
}

type Item = {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  name: TrackName<any>;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  properties: TrackProperties<any>;
  tags: Promise<TrackTags>;
  /** `tags` once settled: a page being hidden can await nothing, and sends what it has. */
  settled?: TrackTags;
  /** Decided when the event happens, as GA4 and PostHog decide it, never when it is sent. */
  session_id: string;
  timestamp: string;
  options: TrackOptions;
};

/**
 * Tags belong to the moment the event happened, not to the moment its batch goes out: a queued
 * event waits up to `delay` ms, and a single page app can navigate in that window, which would
 * stamp every pending event with the URL of the page the user has already left.
 *
 * The promise then sits in the queue with nothing awaiting it, so a failure has to be absorbed
 * here — an unhandled rejection would surface as a global error long before `sendEvents` could
 * catch it. Falling back to the last built tags keeps the event, minus whatever changed since.
 */
async function captureTags(): Promise<TrackTags> {
  try {
    return await config.getTags();
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
    return cache.tags ?? {};
  }
}

/**
 * The events not yet sent, and the only place they are: a batch leaves it at the moment it is
 * handed to `fetch` or to a beacon, never earlier. So when the page is hidden or left,
 * everything still unsent is right here for `sendPendingEvents`.
 */
const list: Item[] = [];
const batchSize = 10;
const delay = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queues an event, preceded by a `session_start` when it is the one that opens a session.
 *
 * The session is decided here, when the event happens, as GA4 and PostHog decide it: the
 * `session_start` then sits in the queue right before the event that opened the session, so
 * wherever that event goes — a batch, a beacon, a retry — its announcement has gone ahead of it.
 * It carries that event's tags and time, as GA4 derives it from the hit that started the
 * session: the landing page is where the session began, whatever the page has navigated to by
 * the time the batch goes out.
 */
function enqueue(name: Item['name'], properties: Item['properties'], options: TrackOptions) {
  const timestamp = new Date().toISOString();
  const tags = captureTags();
  const { id: session_id, started } = getSession().touch(Date.parse(timestamp));
  const item = (fields: Pick<Item, 'name' | 'properties' | 'options'>): Item => {
    const result: Item = { ...fields, tags, timestamp, session_id };
    void tags.then((settled) => {
      result.settled = settled;
    });
    return result;
  };
  if (started) {
    list.push(
      item({ name: 'session_start', properties: {}, options: { enableThirdPartyTracking: false } })
    );
  }
  list.push(item({ name, properties, options }));
}

/**
 * Sends the queue. Everything that has to be awaited is awaited first, and only then are the
 * events taken off the queue and handed to `fetch` in the same synchronous step — so there is
 * no moment at which an event is neither queued nor sent.
 */
async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (list.length === 0) return;

  let events: Item[] = [];
  try {
    await getTokenBucket().removeTokens();
    const visitor_id = (await getVisitor()).id;
    const headers = await config.getHeaders();
    // Settled before the events leave the queue; those queued meanwhile are a microtask away.
    await Promise.all(list.map((event) => event.tags));

    events = list.splice(0);
    if (events.length === 0) return;
    const dto: CreateTrackEventDTO = await Promise.all(
      events.map(async (event) => ({
        name: event.name,
        properties: event.properties,
        tags: await event.tags,
        visitor_id,
        session_id: event.session_id,
        platform: config.platform,
        environment: config.environment,
        timestamp: event.timestamp,
      }))
    );

    const response = await fetch(`${config.endpoint}/events`, {
      method: 'POST',
      credentials: 'include',
      // Survive the page being unloaded mid-flight: the request outlives the page, and the
      // body stays far under keepalive's 64KB in-flight budget.
      keepalive: true,
      headers,
      body: JSON.stringify(dto),
    });

    if (!response.ok) {
      throw new Error(`Failed to send track event: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as TrackEventResponse;

    events.forEach((event, index) => {
      const eventId = data.at(index)?.id;
      event.options.onSucceed?.(eventId ? { id: eventId } : undefined);
      // An explicit false, not falsiness: a caller passing `{ onSucceed }` replaces the options
      // object wholesale, and leaving the flag out must not silently switch forwarding off.
      if (event.options.enableThirdPartyTracking === false || IGNORED_EVENTS.includes(event.name)) {
        return;
      }
      config.thirdPartyTrackers.forEach((tracker) => {
        try {
          tracker(event.name, event.properties, eventId);
        } catch (e: unknown) {
          // A third-party script does not get to take the rest of the batch with it.
          if (e instanceof Error) console.log(e.message);
        }
      });
    });
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
    // `fetch` has already retried the transient failures by the time a batch fails here; what
    // remains is a batch the server rejected outright — one invalid event fails the whole batch
    // — or a network that stayed down past the retries. The other events are reported lost;
    // `session_start` alone goes back on the queue for the next send, because it is the
    // session's only attribution record: a session without one has no channel, and its every
    // later event drops out of an attribution join.
    const starts = events.filter((event) => event.name === 'session_start');
    list.unshift(...starts);
    events
      .filter((event) => event.name !== 'session_start')
      .forEach((event) => event.options.onError?.(e));
  }
}

export function track<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  enqueue(name, properties, options);
  if (list.length >= batchSize) {
    void flush();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

/** Sends the event now, with whatever is queued, and resolves once it has been sent or lost. */
export async function trackAsync<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  await new Promise<void>((resolve) => {
    enqueue(name, properties, {
      ...options,
      onSucceed: (response) => {
        options.onSucceed?.(response);
        resolve();
      },
      onError: (error) => {
        options.onError?.(error);
        resolve();
      },
    });
    void flush();
  });
}

/**
 * The visitor id a beacon can carry. It is persisted, so a returning visitor already has one
 * before `getVisitor` has finished its round trip for this page. Requiring the in-memory copy
 * threw away exactly the events a beacon exists for: everything a visit accrues before its first
 * batch comes back, which for a short visit is the whole of it. A visitor the server has never
 * seen has none: the server would reject its events.
 */
function beaconVisitorId(): string | undefined {
  const stored = config.storage.getItem(keys.visitor_id);
  return cache.visitor?.id ?? (stored && stored !== 'undefined' ? stored : undefined);
}

function beacon(dto: CreateTrackEventDTO): boolean {
  // Not every runtime with a `navigator` has it: React Native has neither beacons nor pages.
  if (typeof navigator === 'undefined' || !('sendBeacon' in navigator)) return false;
  const blob = new Blob([JSON.stringify(dto)], { type: 'application/json' });
  return navigator.sendBeacon(`${config.endpoint}/events`, blob);
}

/**
 * Sends the queue by beacon, now: for when the page is hidden or left, the last moment its
 * script is sure to run — what PostHog's `requestQueue.unload()` and GA4 do on the same events.
 * Call it before the engagement beacon: a new session's `session_start` is in this queue.
 *
 * Nothing can be awaited here, so the events go with the tags they have settled on (the last
 * built ones otherwise), and without the server's ids: their third-party trackers are not fired,
 * as an id-less browser event could not be deduplicated against the server's. When no beacon can
 * take them — a visitor the server does not know yet, no `sendBeacon`, a refused body — they stay
 * queued for the usual send, which also creates the visitor.
 */
export function sendPendingEvents() {
  if (list.length === 0) return;
  const visitor_id = beaconVisitorId();
  const dto: CreateTrackEventDTO = list.map((event) => ({
    name: event.name,
    properties: event.properties,
    tags: event.settled ?? cache.tags ?? {},
    visitor_id: visitor_id ?? '',
    session_id: event.session_id,
    platform: config.platform,
    environment: config.environment,
    timestamp: event.timestamp,
  }));
  if (!visitor_id || !beacon(dto)) {
    void flush();
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  list.splice(0).forEach((event) => event.options.onSucceed?.(undefined));
}

export function sendBeacon<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  const visitor_id = beaconVisitorId();
  if (!visitor_id) return;
  // No stored session means no event was ever queued from this storage, so there is no session
  // to report for — and one started here could never be announced. See `Session.extend`.
  const session_id = getSession().extend();
  if (!session_id) return;

  const dto: CreateTrackEventDTO = [
    {
      name,
      properties,
      // Tags are worth less than the event carrying them: an empty set still reports the
      // engagement, and every field in `tagsSchema` is optional.
      tags: cache.tags ?? {},
      visitor_id,
      session_id,
      platform: config.platform,
      environment: config.environment,
      timestamp: new Date().toISOString(),
    },
  ];
  if (beacon(dto)) return;
  console.warn('Failed to send beacon', name, properties);
}
