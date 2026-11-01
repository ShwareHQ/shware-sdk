import { AppEventsLogger, type Params } from 'react-native-fbsdk-next';
import type { UpdateVisitorDTO } from '../schema/index';
import { type AdsOptions, type Integration, adsTracker } from '../third-parties/integration';
import { mapFBEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';

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
 * Hands the signed-in user to Facebook App Events, as `setFBUser` does the Pixel: the user id
 * (`external_id`) and the advanced matching fields, which the SDK hashes on the device. No user is
 * sign-out (`reset()`), which clears both.
 */
export function setFBUser({ user_id, user_data }: Omit<UpdateVisitorDTO, 'tags'>) {
  AppEventsLogger.setUserID(user_id || null);
  const address = getFirst(user_data?.address);
  AppEventsLogger.setUserData({
    email: getFirst(user_data?.email),
    phone: getFirst(user_data?.phone_number),
    firstName: address?.first_name,
    lastName: address?.last_name,
    city: address?.city,
    state: address?.region,
    zip: address?.postal_code,
    country: address?.country,
  });
}

/**
 * Facebook App Events: the events `mapFBEvent` maps to a Meta standard event, and `customEvents`
 * — the app's counterpart of `metaAds`.
 */
export function metaAppEvents(options: AdsOptions = {}): Integration {
  const isStandard = (name: string) => mapFBEvent(name as TrackName)[0] === 'track';
  return {
    type: 'ads',
    track: adsTracker(sendFBEvent, isStandard, options.customEvents ?? []),
    setUser: setFBUser,
  };
}
