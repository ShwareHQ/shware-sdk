import { AppEventsLogger, type Params } from 'react-native-fbsdk-next';
import { type AdsOptions, type Integration, adsTracker } from '../third-parties/integration';
import { mapFBEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';

/**
 * ref: https://developers.facebook.com/docs/app-events/guides/maximize-in-app-ad-revenue/
 *
 * Synchronous, like `logEvent`: a tracker returns `void | boolean`, which an `async` function's
 * promise would not satisfy. Callers that still `await` it keep compiling.
 */
export function sendFBEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  const [_, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  AppEventsLogger.logEvent(fbEventName, fbEventProperties as Params);
}

/**
 * Facebook App Events: the events `mapFBEvent` maps to a Meta standard event, and `customEvents`
 * — the app's counterpart of `metaAds`.
 */
export function metaAppEvents(options: AdsOptions = {}): Integration {
  const isStandard = (name: string) => mapFBEvent(name as TrackName)[0] === 'track';
  return { type: 'ads', track: adsTracker(sendFBEvent, isStandard, options.customEvents ?? []) };
}
