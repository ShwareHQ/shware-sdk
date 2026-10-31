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
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('GA has not been initialized');
    return false;
  }
  window.gtag('event', name, properties);
}

export function setGAUser({ user_id, user_data }: UpdateVisitorDTO) {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('GA has not been initialized');
    return;
  }
  // No user is sign-out (`reset()`): GA keeps a set user_id for every later event on the page, so
  // it is cleared explicitly.
  window.gtag('set', 'user_id', user_id || null);
  if (user_data) window.gtag('set', 'user_data', user_data);
}
