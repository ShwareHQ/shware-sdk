import { CreateTrackEventDTO, EventName, Properties, TrackEventResponse } from './types';
import { options, http } from './setup';
import { invariant } from './utils';

export interface TrackOptions {
  enableThirdPartyLogging?: boolean;
  onSucceed?: (response?: TrackEventResponse) => void;
  onError?: (error: unknown) => void;
}

const defaultOptions: TrackOptions = { enableThirdPartyLogging: true };

async function trackAsync<T extends EventName = EventName>(
  name: T,
  properties?: Properties<T>,
  trackOptions: TrackOptions = defaultOptions
) {
  invariant(options.endpoint, 'endpoint is required');
  invariant(options.tagsFetcher, 'tagsFetcher is required');
  try {
    await options.tokenBucket.removeTokens();
    const tags = await options.tagsFetcher();
    const timestamp = new Date().getTime();
    const dto: CreateTrackEventDTO<T> = { name, tags, properties, timestamp };
    const { data } = await http.post<TrackEventResponse>(`/tracks`, dto);

    // send to third-party loggers, for example Google Analytics and Facebook Pixel
    if (!trackOptions.enableThirdPartyLogging || !options.thirdPartyLoggers) return;
    options.thirdPartyLoggers.forEach((logger) => logger(name, properties, data.id));
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
