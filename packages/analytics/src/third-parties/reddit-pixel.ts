import { type PixelId, type RDT, mapRDTEvent } from '../track/rdt';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

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
