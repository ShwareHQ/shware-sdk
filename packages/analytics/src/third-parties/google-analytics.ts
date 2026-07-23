import type { UpdateVisitorDTO } from '../schema/index';
import type { Gtag } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

declare global {
  interface Window {
    /** Undefined until the Google tag (gtag.js) script has loaded. */
    gtag?: Gtag['gtag'];
  }
}

export function sendGAEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (!window.gtag) {
    console.warn('GA has not been initialized');
    return;
  }
  window.gtag('event', name, properties);
}

export function setGAUser({ user_id, user_data, properties }: UpdateVisitorDTO) {
  if (!window.gtag) {
    console.warn('GA has not been initialized');
    return;
  }
  if (user_id) window.gtag('set', 'user_id', user_id);
  if (user_data) window.gtag('set', 'user_data', user_data);
  if (properties) window.gtag('set', 'user_properties', properties as never);
}
