import { PixelId, mapFBEvent } from '../track/fbq';
import { getFirst } from '../utils/field';
import type { FBQ } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  interface Window extends FBQ {}
}

const metrics = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'];

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

  const { fbq } = window;
  const options = { eventID: event_id };
  const [type, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  if (type === 'track') {
    fbq(type, fbEventName, fbEventProperties, options);
  } else {
    fbq(type, fbEventName, fbEventProperties, options);
  }
}

export function setFBUser(pixelId: PixelId) {
  return ({ user_id, data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.fbq) {
      console.warn('fbq has not been initialized');
      return;
    }

    const address = getFirst(data?.address);

    window.fbq('init', pixelId, {
      em: getFirst(data?.email),
      fn: address?.first_name,
      ln: address?.last_name,
      ph: getFirst(data?.phone_number),
      external_id: user_id,
      ct: address?.city,
      st: address?.street,
      zp: address?.postal_code,
      country: address?.country,
    });
  };
}
