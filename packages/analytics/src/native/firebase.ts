import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import type { StandardEvents } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

const analytics = getAnalytics();

export async function sendFirebaseEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  // @react-native-firebase/analytics 26 made the modular logEvent fire-and-forget (void).
  // sendFirebaseEvent stays async so callers that await it keep compiling.
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
