import { CreateTrackEventDTO, EventName, Properties, TrackEventResponse } from '../../types';
import { config } from '../setup';
import { TokenBucket } from '../utils';
import { getVisitor } from '../visitor';

export interface TrackOptions {
  enableThirdPartyLogging?: boolean;
  onSucceed?: (response?: TrackEventResponse) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = { enableThirdPartyLogging: true };

const tokenBucket = new TokenBucket({ rate: 1, capacity: 20, requested: 2 });

async function trackAsync<T extends EventName = EventName>(
  name: T,
  properties?: Properties<T>,
  trackOptions: TrackOptions = defaultOptions
) {
  try {
    await tokenBucket.removeTokens();
    const dto: CreateTrackEventDTO<T> = {
      name,
      properties,
      tags: await config.getTags(),
      visitor_id: (await getVisitor()).id,
      timestamp: new Date().toISOString(),
    };
    const { data } = await config.http.post<TrackEventResponse>(`/events`, dto);

    // send to third-party loggers, for example Google Analytics and Facebook Pixel
    if (!trackOptions.enableThirdPartyLogging || !config.thirdPartyLoggers) return;
    config.thirdPartyLoggers.forEach((logger) => logger(name, properties, data.id));
    trackOptions.onSucceed?.(data);
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.log('Failed to send track event:', e.message);
    }
    trackOptions.onError?.(e);
  }
}

export function track<T extends EventName = EventName>(
  name: T,
  properties?: Properties<T>,
  trackOptions: TrackOptions = defaultOptions
) {
  trackAsync(name, properties, trackOptions).catch(console.error);
}
