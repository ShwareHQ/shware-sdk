import { posthog } from 'posthog-js';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { UpdateVisitorDTO } from '../visitor/types';

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendPosthogEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  posthog.capture(name, properties);
  if (name === 'logout') {
    posthog.reset();
  }
}

export function setPosthogUser({ user_id, distinct_id, data }: UpdateVisitorDTO) {
  if (!distinct_id && !user_id) return;
  posthog.identify(distinct_id ?? user_id, { email: getFirst(data?.email) });
}
