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
  onSucceed?: (response?: TrackEventResponse) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = { enableThirdPartyTracking: true };

const REQUEST_TOKENS = 2;
const tokenBucket = new TokenBucket({
  bucketSize: 20,
  interval: 'second',
  tokensPerInterval: 1,
});

async function trackAsync<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  trackOptions: TrackOptions = defaultOptions
) {
  try {
    await tokenBucket.removeTokens(REQUEST_TOKENS);
    const dto: CreateTrackEventDTO<T> = {
      name,
      properties,
      tags: await config.getTags(),
      visitor_id: (await getVisitor()).id,
      timestamp: new Date().toISOString(),
    };
    const { data } = await config.http.post<TrackEventResponse>(`/events`, dto);

    // send to third-party loggers, for example Google Analytics and Facebook Pixel
    if (!trackOptions.enableThirdPartyTracking || !config.thirdPartyTrackers) return;
    config.thirdPartyTrackers.forEach((tracker) => tracker(name, properties, data.id));
    trackOptions.onSucceed?.(data);
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.log('Failed to send track event:', e.message);
    }
    trackOptions.onError?.(e);
  }
}

export function track<T extends EventName = EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  trackOptions: TrackOptions = defaultOptions
) {
  trackAsync(name, properties, trackOptions).catch(console.error);
}
