import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
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

/** Firebase Analytics: every event, for behavior analysis — the app's counterpart of GA4. */
export function firebaseAnalytics(): Integration {
  return { type: 'analytics', track: sendFirebaseEvent };
}
