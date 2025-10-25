import { mapRDTEvent } from '../track/rdt';
import { getFirst } from '../utils/field';
import type { PixelId, RDT } from '../track/rdt';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  interface Window extends RDT {}
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendRedditEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
) {
  if (typeof window === 'undefined' || !window.rdt) {
    console.warn('rdt has not been initialized');
    return;
  }
  if (metrics.includes(name)) return;

  const [type, params] = mapRDTEvent(name, properties, eventId);
  if (type === 'Custom') {
    window.rdt('track', type, JSON.parse(JSON.stringify(params)));
  } else {
    window.rdt('track', type, JSON.parse(JSON.stringify(params)));
  }
}

export function setRedditUser(pixelId: PixelId) {
  return ({ user_id, data }: UpdateVisitorDTO) => {
    if (!window.rdt) {
      console.warn('rdt has not been initialized');
      return;
    }

    window.rdt('init', pixelId, {
      email: getFirst(data?.email),
      phoneNumber: getFirst(data?.phone_number),
      externalId: user_id,
    });
  };
}
