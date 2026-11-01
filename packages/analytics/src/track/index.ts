import { TokenBucket, fetch } from '@shware/utils';
import { v7 as uuidv7 } from 'uuid';
import type { CreateTrackEventDTO } from '../schema/index';
import { cache, config } from '../setup/index';
import { getSession } from '../setup/session';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import type { Integration } from '../third-parties/integration';
import { visitorId } from '../visitor/id';
import type { EventName, TrackEventResponse, TrackName, TrackProperties, TrackTags } from './types';

export interface TrackOptions {
  enableThirdPartyTracking?: boolean;
  /**
   * Called once the server (or a beacon) has taken the event, with the event's id: the one
   * generated when it was tracked, which the third-party trackers were given too. `beacon` is
   * set when the event went by `sendPendingEvents`: the browser queued it, but a beacon cannot
   * tell delivered from dropped, so it is taken, not confirmed.
   */
  onSucceed?: (response?: TrackEventResponse[number] & { beacon?: true }) => void;
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

/**
 * An event as the server takes it, one element of a `POST /events` batch — with the id the SDK
 * always generates, and the name and properties as `track` types them.
 */
type TrackEvent = Omit<CreateTrackEventDTO[number], 'id' | 'name' | 'properties'> & {
  id: string;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  name: TrackName<any>;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  properties: TrackProperties<any>;
};

type Item = {
  /**
   * The event as it is sent, complete from the moment it is tracked: its id (a uuidv7 the server
   * stores it under, `on conflict (id) do nothing`, and the deduplication id the third-party
   * trackers are given at once), and the visitor, session and time it happened in — decided then,
   * as GA4 and PostHog decide them, never when the batch goes out. `reset()` replaces the visitor
   * and session, and an event tracked before it still belongs to the ones it happened in.
   *
   * `tags` starts as the last built tags and is replaced by the event's own once they are
   * captured (`tagged`): a page being hidden can await nothing, and sends what it has.
   */
  event: TrackEvent;
  tagged: Promise<void>;
  options: TrackOptions;
};

/**
 * How an event is created, for the SDK's own callers (`trackOnce`); not exported from the
 * package. `id` carries over the id of an earlier attempt at the same occurrence, and
 * `pixels: false` skips the third-party trackers that attempt has already fired.
 */
export interface EventInit {
  id?: string;
  pixels?: boolean;
}

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
 * Hands the event to the third-party trackers now, as it is tracked, under its own id — not once
 * the server has answered. An event followed by a full-page navigation (an outbound link,
 * `begin_checkout` before the redirect to the payment page, a landing page left at once) reaches
 * the pixels before the page goes, and the server's conversions API, sending the same id, still
 * deduplicates against the browser event. A server that is down no longer takes the pixels down
 * with it either.
 *
 * A tracker that returns `false` is not ready — its pixel's global is not on the page yet, the
 * snippet still loading (the first `page_view` of a visit is tracked right as the page mounts).
 * Those trackers, and only those, are called once more on the next macrotask, with the same event
 * and id, after the inline snippets have had their turn; a tracker still not ready then is given
 * up on, as it was when it ran after the server's answer. Never more than once: a pixel's global
 * either exists by then or the script is blocked.
 */
function firePixels({ event, options }: Item) {
  // An explicit false, not falsiness: a caller passing `{ onSucceed }` replaces the options
  // object wholesale, and leaving the flag out must not silently switch forwarding off.
  if (
    options.enableThirdPartyTracking === false ||
    config.excludeFromIntegrations.includes(event.name) ||
    IGNORED_EVENTS.includes(event.name)
  ) {
    return;
  }
  const notReady = callIntegrations(config.integrations, event);
  if (notReady.length === 0) return;
  setTimeout(() => callIntegrations(notReady, event), 0);
}

/** Hands the event to each integration; returns the ones that said they were not ready. */
function callIntegrations(integrations: readonly Integration[], event: TrackEvent): Integration[] {
  return integrations.filter(({ track }) => {
    try {
      return track(event.name, event.properties, event.id) === false;
    } catch (e: unknown) {
      // A third-party script does not get to take the tracking call, or the other trackers, with it.
      if (e instanceof Error) console.log(e.message);
      return false;
    }
  });
}

/**
 * What an event shares with every other event of the moment it happens: the visitor, the session,
 * the time and the client, with the last built tags until the event's own are captured.
 */
function context(session_id: string, timestamp = new Date().toISOString()) {
  return {
    visitor_id: visitorId(),
    session_id,
    timestamp,
    platform: config.platform,
    environment: config.environment,
    tags: cache.tags ?? {},
  };
}

/** Queues the event, its tags to be filled in once `tags` settles. */
function push(event: TrackEvent, tags: Promise<TrackTags>, options: TrackOptions): Item {
  const tagged = tags.then((settled) => {
    event.tags = settled;
  });
  const item = { event, tagged, options };
  list.push(item);
  return item;
}

const silent: TrackOptions = { enableThirdPartyTracking: false };

/**
 * Queues an event, preceded by a `session_start` when it is the one that opens a session, and
 * fires its third-party trackers.
 *
 * The session is decided here, when the event happens, as GA4 and PostHog decide it: the
 * `session_start` then sits in the queue right before the event that opened the session, so
 * wherever that event goes — a batch, a beacon, a retry — its announcement has gone ahead of it.
 * It carries that event's tags and time, as GA4 derives it from the hit that started the
 * session: the landing page is where the session began, whatever the page has navigated to by
 * the time the batch goes out.
 */
function enqueue(
  name: TrackEvent['name'],
  properties: TrackEvent['properties'],
  options: TrackOptions,
  init: EventInit = {}
): Item {
  const timestamp = new Date().toISOString();
  const { id: session_id, started } = getSession().touch(Date.parse(timestamp));
  const at = context(session_id, timestamp);
  const tags = captureTags();
  if (started) push({ ...at, id: uuidv7(), name: 'session_start', properties: {} }, tags, silent);
  const item = push({ ...at, id: init.id ?? uuidv7(), name, properties }, tags, options);
  if (init.pixels !== false) firePixels(item);
  return item;
}

/**
 * Ends the current session for `reset()`. What it accrued and has not reported goes out as a
 * `user_engagement`, as when the page is closed, and the queue is sent. Synchronous: every queued
 * event already carries its visitor and session, so the caller can replace the visitor right after.
 */
export function endSession() {
  const { id, engagement_time_msec } = getSession().end();
  if (id && engagement_time_msec > 0) {
    const properties = { engagement_time_msec, trigger: 'reset' };
    push(
      { ...context(id), id: uuidv7(), name: 'user_engagement', properties },
      captureTags(),
      silent
    );
  }
  if (list.length > 0) void flush();
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

  let headers: Record<string, string>;
  try {
    await getTokenBucket().removeTokens();
    headers = await config.getHeaders();
    // Tagged before the events leave the queue; those queued meanwhile are a microtask away.
    await Promise.all(list.map((item) => item.tagged));
  } catch (e: unknown) {
    // Nothing has left the queue yet: the events wait for the next send.
    if (e instanceof Error) console.log(e.message);
    return;
  }

  // The server takes one visitor per request, and a queue spans two after `reset()`. `send`
  // settles its own failures, so neither batch can take the other down.
  await Promise.all(byVisitor(list.splice(0)).map((batch) => send(batch, headers)));
}

/**
 * The items grouped by the visitor they were tracked under, each group in queue order. Not
 * `Map.groupBy`: it is ES2024, missing from Safari before 17.4 and from Hermes before V1.
 */
function byVisitor(items: Item[]): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const { visitor_id } = item.event;
    groups.set(visitor_id, [...(groups.get(visitor_id) ?? []), item]);
  }
  return [...groups.values()];
}

/** One visitor's batch, as one request. */
async function send(items: Item[], headers: Record<string, string>) {
  try {
    const body = JSON.stringify(items.map((item) => item.event));
    const response = await fetch(`${config.endpoint}/events`, {
      method: 'POST',
      credentials: 'include',
      // Retried although a POST: every event carries its client-generated id, and the server stores
      // a batch it already has `on conflict (id) do nothing`.
      retries: 3,
      // keepalive lets the request survive the page being unloaded mid-flight, within a 64KB
      // budget shared by every such request of the page; a body that could not fit goes as a
      // plain POST rather than failing outright.
      keepalive: body.length < 60_000,
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to send track event: ${response.status} ${await response.text()}`);
    }

    // The body is not read. Every event has had its id since it was tracked, and its trackers
    // were fired with it then. Servers still answer one `{ id }` per event (`TrackEventResponse`),
    // which a server predating client ids fills with ids of its own; neither is needed here, and
    // an answer that is not even JSON does not turn a stored batch into a failure.
    items.forEach(({ event, options }) => options.onSucceed?.({ id: event.id }));
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
    fail(items, e);
  }
}

/**
 * `fetch` has already retried the transient failures by the time a batch fails; what remains is a
 * batch the server rejected outright — one invalid event fails the whole batch — or a network that
 * stayed down past the retries. The other events are reported lost; `session_start` alone goes
 * back on the queue for the next send, because it is the session's only attribution record: a
 * session without one has no channel, and its every later event drops out of an attribution join.
 */
function fail(items: Item[], e: unknown) {
  const isStart = (item: Item) => item.event.name === 'session_start';
  list.unshift(...items.filter(isStart));
  items.filter((item) => !isStart(item)).forEach((item) => item.options.onError?.(e));
}

/** `track`, with the `EventInit` only the SDK itself passes. */
export function queueEvent<T extends EventName = EventName>(
  name: TrackName<T>,
  properties: TrackProperties<T> | undefined,
  options: TrackOptions,
  init?: EventInit
) {
  enqueue(name, properties, options, init);
  if (list.length >= batchSize) {
    void flush();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

/**
 * Queues the event for the next batch — up to 2 s away, at once when the batch is full — and
 * hands it to the third-party trackers now, under the id it is sent with.
 */
export function track<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  queueEvent(name, properties, options);
}

function beacon(dto: CreateTrackEventDTO): boolean {
  // Not every runtime with a `navigator` has it: React Native has neither beacons nor pages.
  if (typeof navigator === 'undefined' || !('sendBeacon' in navigator)) return false;
  // text/plain keeps a cross-origin beacon a CORS simple request: as application/json it needs a
  // preflight, which a page being closed often cannot complete, and the beacon is then dropped.
  // The server reads it as JSON (`zBeaconJson` in @shware/http).
  const blob = new Blob([JSON.stringify(dto)], { type: 'text/plain;charset=UTF-8' });
  return navigator.sendBeacon(`${config.endpoint}/events`, blob);
}

/**
 * Sends the queue by beacon, now: for when the page is hidden or left, the last moment its
 * script is sure to run — what PostHog's `requestQueue.unload()` and GA4 do on the same events.
 * Call it before the engagement beacon: a new session's `session_start` is in this queue.
 *
 * Nothing can be awaited here, so the events go with the tags they have settled on (the last
 * built ones otherwise). Each goes with the id it was tracked with, and its third-party trackers
 * were fired then, under that id: none is fired again here. The visitor id is local
 * (`visitorId`), so a first visit left within a second is sent like any other. One beacon per
 * visitor, as one request per visitor in `flush`; a visitor's events no beacon can take — no
 * `sendBeacon`, a refused body — stay queued for the usual send.
 */
export function sendPendingEvents() {
  if (list.length === 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  byVisitor(list.splice(0)).forEach((batch) => {
    if (!beacon(batch.map((item) => item.event))) {
      list.push(...batch);
      return;
    }
    batch.forEach(({ event, options }) => options.onSucceed?.({ id: event.id, beacon: true }));
  });
  if (list.length > 0) void flush();
}

export function sendBeacon<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  // No stored session means no event was ever queued from this storage, so there is no session
  // to report for — and one started here could never be announced. See `Session.extend`.
  const session_id = getSession().extend();
  if (!session_id) return;

  // With the last built tags: they are worth less than the event carrying them, and an empty set
  // still reports the engagement (every field in `tagsSchema` is optional).
  if (beacon([{ ...context(session_id), id: uuidv7(), name, properties }])) return;
  console.warn('Failed to send beacon', name, properties);
}
