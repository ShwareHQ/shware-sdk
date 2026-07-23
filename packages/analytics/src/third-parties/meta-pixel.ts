import type { UpdateVisitorDTO } from '../schema/index';
import { type FBQ, type PixelId, mapFBEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';

declare global {
  interface Window {
    /** Undefined until the Meta Pixel script has loaded. */
    fbq?: FBQ['fbq'];
  }
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendFBEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  event_id?: string
) {
  if (typeof window === 'undefined' || !window.fbq) {
    console.warn('fbq has not been initialized');
    return;
  }
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  const options = { eventID: event_id };
  const [type, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  if (type === 'track') {
    window.fbq(type, fbEventName, fbEventProperties, options);
  } else {
    window.fbq(type, fbEventName, fbEventProperties, options);
  }
}

export function setFBUser(pixelId: PixelId) {
  return ({ user_id, user_data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.fbq) {
      console.warn('fbq has not been initialized');
      return;
    }

    const address = getFirst(user_data?.address);

    window.fbq('init', pixelId, {
      em: getFirst(user_data?.email),
      fn: address?.first_name,
      ln: address?.last_name,
      ph: getFirst(user_data?.phone_number),
      external_id: user_id,
      ct: address?.city,
      st: address?.street,
      zp: address?.postal_code,
      country: address?.country,
    });
  };
}
