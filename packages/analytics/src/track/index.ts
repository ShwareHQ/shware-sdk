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

async function sendEvents(events: Item[]) {
  try {
    if (events.length === 0) return;

    // One read-modify-write of the stored session for the whole batch: it answers which session
    // these events belong to and whether this batch is the one that started it. Timed by the
    // events themselves rather than by this moment — a tab frozen in the background can hold a
    // batch for far longer than `delay`, and those events belong to the session they happened in.
    const firstTimestamp = events[0].timestamp;
    const { id: session_id, started } = getSession().touch(
      Date.parse(firstTimestamp),
      Date.parse(events[events.length - 1].timestamp)
    );
    if (started) {
      events.unshift({
        name: 'session_start',
        properties: {},
        options: { enableThirdPartyTracking: false },
        tags: captureTags(),
        // The session began with the event that opened it, not at this moment: a batch held in a
        // frozen tab would otherwise announce its session later than the events inside it.
        timestamp: firstTimestamp,
      });
    }

    await getTokenBucket().removeTokens();

    const visitor_id = (await getVisitor()).id;

    const dto: CreateTrackEventDTO = await Promise.all(
      events.map(async (event) => ({
        name: event.name,
        properties: event.properties,
        tags: await event.tags,
        visitor_id,
        session_id,
        platform: config.platform,
        environment: config.environment,
        timestamp: event.timestamp,
      }))
    );

    const response = await fetch(`${config.endpoint}/events`, {
      method: 'POST',
      credentials: 'include',
      headers: await config.getHeaders(),
      body: JSON.stringify(dto),
    });

    if (!response.ok) {
      throw new Error(`Failed to send track event: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as TrackEventResponse;

    let index = 0;
    while (events.length > 0) {
      const event = events.shift();
      if (!event) {
        index++;
        continue;
      }
      const { options, name, properties } = event;
      const eventId = data.at(index)?.id;
      options.onSucceed?.(eventId ? { id: eventId } : undefined);
      index++;
      // An explicit false, not falsiness: a caller passing `{ onSucceed }` replaces the options
      // object wholesale, and leaving the flag out must not silently switch forwarding off.
      if (options.enableThirdPartyTracking === false || IGNORED_EVENTS.includes(name)) {
        continue;
      }
      config.thirdPartyTrackers.forEach((tracker) => {
        try {
          tracker(name, properties, eventId);
        } catch (e: unknown) {
          // A third-party script does not get to take the rest of the batch with it. This loop is
          // still draining `events` with `shift`, so a throw would escape to the catch below and
          // report failure to whatever is left in the queue — for events the server has already
          // accepted, and after the ones ahead of them were told they succeeded.
          if (e instanceof Error) console.log(e.message);
        }
      });
    }
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
    events.forEach((event) => event.options.onError?.(e));
  }
}

const batch = 10;
const delay = 2000;
const list: Item[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Both paths into a send go through here, so a batch that fills up cancels the timer the
 * previous push armed rather than leaving it to wake up on its own with nothing to send.
 */
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (list.length === 0) return;
  const copy = [...list];
  list.length = 0;
  void sendEvents(copy);
}

export function track<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  list.push({
    name,
    properties,
    options,
    tags: captureTags(),
    timestamp: new Date().toISOString(),
  });
  if (list.length >= batch) {
    flush();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

export async function trackAsync<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  await sendEvents([
    { name, properties, options, tags: captureTags(), timestamp: new Date().toISOString() },
  ]);
}

export function sendBeacon<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  // The visitor id is persisted, so a returning visitor already has one before `getVisitor` has
  // finished its round trip for this page. Requiring the in-memory copy threw away exactly the
  // events this function exists for: everything a visit accrues before its first batch comes
  // back, which for a short visit is the whole of it.
  const stored = config.storage.getItem(keys.visitor_id);
  const visitor_id = cache.visitor?.id ?? (stored && stored !== 'undefined' ? stored : undefined);
  if (!visitor_id) return;

  const dto: CreateTrackEventDTO = [
    {
      name,
      properties,
      // Tags are worth less than the event carrying them: an empty set still reports the
      // engagement, and every field in `tagsSchema` is optional.
      tags: cache.tags ?? {},
      visitor_id,
      session_id: getSession().extend(),
      platform: config.platform,
      environment: config.environment,
      timestamp: new Date().toISOString(),
    },
  ];
  const blob = new Blob([JSON.stringify(dto)], { type: 'application/json' });
  const success = navigator.sendBeacon(`${config.endpoint}/events`, blob);
  if (success) return;
  console.warn('Failed to send beacon', name, properties);
}
