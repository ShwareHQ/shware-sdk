import {
  getAnalytics,
  initiateOnDeviceConversionMeasurementWithEmailAddress,
  initiateOnDeviceConversionMeasurementWithPhoneNumber,
  logEvent,
  setUserId,
} from '@react-native-firebase/analytics';
import type { UpdateVisitorDTO } from '../schema/index';
import type { Integration } from '../third-parties/integration';
import type { StandardEvents } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';

const analytics = getAnalytics();

/**
 * A `ThirdPartyTracker` for Firebase Analytics. Synchronous: @react-native-firebase/analytics 26
 * made the modular `logEvent` fire-and-forget (void), and a tracker's return is `void | boolean`
 * (`false` meaning "not ready"), which an `async` function's promise would not satisfy. Callers
 * that still `await` it keep compiling.
 */
export function sendFirebaseEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (name === 'screen_view') {
    logEvent(analytics, 'screen_view', {
      firebase_screen: (properties as StandardEvents['screen_view'] | undefined)?.screen_name,
      firebase_screen_class: (properties as StandardEvents['screen_view'] | undefined)
        ?.screen_class,
    });
  } else {
    logEvent(analytics, name, properties);
  }
}

function logError(e: unknown) {
  if (e instanceof Error) console.log(e.message);
}

/**
 * Sets Firebase's user id to the signed-in user, as `setGAUser` does GA's; no user is sign-out
 * (`reset()`), which clears it. The user properties stay free of PII, as Google requires: the
 * email and phone number go to on-device conversion measurement instead, which matches Google
 * Ads app campaign clicks on the device without them leaving it — iOS only, a no-op elsewhere.
 */
export function setFirebaseUser({ user_id, user_data }: Omit<UpdateVisitorDTO, 'tags'>) {
  setUserId(analytics, user_id || null).catch(logError);
  const email = getFirst(user_data?.email);
  if (email)
    initiateOnDeviceConversionMeasurementWithEmailAddress(analytics, email).catch(logError);
  const phone = getFirst(user_data?.phone_number);
  if (phone) initiateOnDeviceConversionMeasurementWithPhoneNumber(analytics, phone).catch(logError);
}

/** Firebase Analytics: every event, for behavior analysis — the app's counterpart of GA4. */
export function firebaseAnalytics(): Integration {
  return { type: 'analytics', track: sendFirebaseEvent, setUser: setFirebaseUser };
}
