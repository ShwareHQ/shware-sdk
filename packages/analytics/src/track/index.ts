import { TokenBucket } from 'limiter';
import { config } from '../setup/index';
import { getVisitor } from '../visitor/index';
import type {
  CreateTrackEventDTO,
  EventName,
  TrackName,
  TrackProperties,
  TrackEventResponse,
} from './types';

export interface TrackOptions {
  enableThirdPartyTracking?: boolean;
  onSucceed?: (response?: TrackEventResponse[number]) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = { enableThirdPartyTracking: true };

const REQUEST_TOKENS = 2;
const tokenBucket = new TokenBucket({
  bucketSize: 20,
  interval: 'second',
  tokensPerInterval: 1,
});

type Item = {
  name: TrackName<any>;
  properties: TrackProperties<any>;
  timestamp: string;
  options: TrackOptions;
};

async function sendEvents(events: Item[]) {
  try {
    if (events.length === 0) return;
    await tokenBucket.removeTokens(REQUEST_TOKENS);

    const tags = await config.getTags();
    const visitor_id = (await getVisitor()).id;
    const dto: CreateTrackEventDTO = events.map((event) => ({
      name: event.name,
      properties: event.properties,
      tags,
      visitor_id,
      timestamp: event.timestamp,
    }));
    const { data } = await config.http.post<TrackEventResponse>(`/events`, dto);
    let index = 0;
    while (events.length > 0) {
      const { options, name, properties } = events.shift()!;
      const eventId = data[index].id;
      options.onSucceed?.({ id: eventId });
      index++;
      if (!options.enableThirdPartyTracking || !config.thirdPartyTrackers) continue;
      config.thirdPartyTrackers.forEach((tracker) => tracker(name, properties, eventId));
    }
  } catch (e: unknown) {
    if (e instanceof Error) console.log('Failed to send track event:', e.message);
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
