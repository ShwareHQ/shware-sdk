import { getAnalytics, logEvent, setUserId } from '@react-native-firebase/analytics';
import type { UpdateVisitorDTO } from '../schema/index';
import type { Integration } from '../third-parties/integration';
import type { StandardEvents } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

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

/**
 * Sets Firebase's user id to the signed-in user, as `setGAUser` does GA's; no user is sign-out
 * (`reset()`), which clears it. Only the id: Firebase's user properties must not carry PII.
 */
export function setFirebaseUser({ user_id }: Pick<UpdateVisitorDTO, 'user_id'>) {
  setUserId(analytics, user_id || null).catch((e: unknown) => {
    if (e instanceof Error) console.log(e.message);
  });
}

/** Firebase Analytics: every event, for behavior analysis — the app's counterpart of GA4. */
export function firebaseAnalytics(): Integration {
  return { type: 'analytics', track: sendFirebaseEvent, setUser: setFirebaseUser };
}
