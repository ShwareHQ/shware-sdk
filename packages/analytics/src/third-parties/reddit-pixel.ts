import { mapRDTEvent } from '../track/rdt';
import { getFirst } from '../utils/field';
import type { PixelId, RDT } from '../track/rdt';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  interface Window extends RDT {}
}

export function sendRDTEvent<T extends EventName>(
  name: TrackName<T>,
  _properties?: TrackProperties<T>,
  event_id?: string
) {
  if (typeof window === 'undefined' || !window.rdt) {
    console.warn('rdt has not been initialized');
    return;
  }

  const { rdt } = window;
  const [type, params] = mapRDTEvent(name, event_id);
  if (type === 'Custom') {
    rdt('track', type, params);
  } else {
    rdt('track', type, params);
  }
}

export function setRDTUser(pixelId: PixelId) {
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
