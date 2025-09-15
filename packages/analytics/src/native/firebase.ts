import { logEvent, getAnalytics } from '@react-native-firebase/analytics';
import type { StandardEvents } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

const analytics = getAnalytics();

export async function sendFirebaseEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (name === 'screen_view') {
    await logEvent(analytics, 'screen_view', {
      firebase_screen: (properties as StandardEvents['screen_view'])?.screen_name,
      firebase_screen_class: (properties as StandardEvents['screen_view'])?.screen_class,
    });
  } else {
    await logEvent(analytics, name, properties);
  }
}
