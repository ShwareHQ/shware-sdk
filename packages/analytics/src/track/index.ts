import { TokenBucket, fetch } from '@shware/utils';
import { cache, config } from '../setup/index';
import { session } from '../setup/session';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { getVisitor } from '../visitor/index';
import type { EventName, TrackEventResponse, TrackName, TrackProperties } from './types';
import type { CreateTrackEventDTO } from '../schema/index';

export interface TrackOptions {
  enableThirdPartyTracking?: boolean;
  onSucceed?: (response?: TrackEventResponse[number]) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = { enableThirdPartyTracking: true };
const tokenBucket = new TokenBucket({ rate: 1, capacity: 20, requested: 2 });

type Item = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name: TrackName<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: TrackProperties<any>;
  timestamp: string;
  options: TrackOptions;
};

async function sendEvents(events: Item[]) {
  try {
    if (events.length === 0) return;

    if (session.isExpired()) {
      session.refresh();
      events.unshift({
        name: 'session_start',
        properties: {},
        options: { enableThirdPartyTracking: false },
        timestamp: new Date().toISOString(),
      });
    } else {
      session.updateLastActiveTime();
    }

    await tokenBucket.removeTokens();

    const tags = await config.getTags();
    const visitor_id = (await getVisitor()).id;

    const dto: CreateTrackEventDTO = events.map((event) => ({
      name: event.name,
      properties: event.properties,
      tags,
      visitor_id,
      session_id: session.getId(),
      platform: config.platform,
      environment: config.environment,
      timestamp: event.timestamp,
    }));

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
      const { options, name, properties } = events.shift()!;
      const eventId = data[index].id;
      options.onSucceed?.({ id: eventId });
      index++;
      if (
        !config.thirdPartyTrackers ||
        !options.enableThirdPartyTracking ||
        IGNORED_EVENTS.includes(name)
      ) {
        continue;
      }
      config.thirdPartyTrackers.forEach((tracker) => tracker(name, properties, eventId));
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

export function track<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  list.push({ name, properties, options, timestamp: new Date().toISOString() });
  if (list.length >= batch) {
    const copy = [...list];
    list.length = 0;
    sendEvents(copy);
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const copy = [...list];
    list.length = 0;
    sendEvents(copy);
  }, delay);
}

export async function trackAsync<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options: TrackOptions = defaultOptions
) {
  await sendEvents([{ name, properties, options, timestamp: new Date().toISOString() }]);
}

export function sendBeacon<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (!cache.tags || !cache.visitor) return;
  session.updateLastActiveTime();

  const dto: CreateTrackEventDTO = [
    {
      name,
      properties,
      tags: cache.tags,
      visitor_id: cache.visitor.id,
      session_id: session.getId(),
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
