import type { Gtag } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  interface Window extends Gtag {}
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

export function setGAUser({ user_id, data, properties }: UpdateVisitorDTO) {
  if (!window.gtag) {
    console.warn('GA has not been initialized');
    return;
  }
  if (user_id) window.gtag('set', 'user_id', user_id);
  if (data) window.gtag('set', 'user_data', data);
  if (properties) window.gtag('set', 'user_properties', properties);
}
