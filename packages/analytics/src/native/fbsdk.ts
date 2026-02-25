import { AppEventsLogger, type Params } from 'react-native-fbsdk-next';
import { mapFBEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';

/**
 * ref: https://developers.facebook.com/docs/app-events/guides/maximize-in-app-ad-revenue/
 */
export async function sendFBEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  const { logEvent } = AppEventsLogger;
  const [_, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  logEvent(fbEventName, fbEventProperties as Params);
}
