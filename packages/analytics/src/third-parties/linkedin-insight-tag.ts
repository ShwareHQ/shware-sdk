import { getFirst } from '../utils/field';
import type { Lintrk } from '../track/lintrk';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Window extends Lintrk {}
}

/**
 * LinkedIn Conversion Config:
 * example:
 * {
 *   purchase: 123,
 *   add_to_cart: 456,
 *   add_to_wishlist: 789,
 * }
 */
export type LinkedinConversionConfig = Record<Lowercase<string>, number>;

export function sendLinkedinEvent(config: LinkedinConversionConfig) {
  return <T extends EventName>(
    name: TrackName<T>,
    _properties?: TrackProperties<T>,
    event_id?: string
  ) => {
    if (typeof window === 'undefined' || !window.lintrk) {
      console.warn('lintrk has not been initialized');
      return;
    }

    const conversion_id = config[name as Lowercase<string>];
    if (!conversion_id) return;
    window.lintrk('track', { conversion_id, event_id });
  };
}

export function setLinkedinUser({ data }: UpdateVisitorDTO) {
  if (typeof window === 'undefined' || !window.lintrk) {
    console.warn('lintrk has not been initialized');
    return;
  }

  const email = getFirst(data?.email);
  if (!email) return;
  window.lintrk('setUserData', { email });
}
