import { posthog } from 'posthog-js';
import type { UpdateVisitorDTO } from '../schema/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendPosthogEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  // `document`, not `window`: React Native defines `window` as an alias of `global`, so a
  // window check would pass there and then throw on `window.location`, which it has no such
  // alias for. `posthog-js` is the browser SDK and cannot run there anyway.
  if (typeof document === 'undefined') return;
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  posthog.capture(name, properties);
  if (name === 'logout') {
    posthog.reset();
  }
}

export function setPosthogUser({ user_id, distinct_id, user_data }: UpdateVisitorDTO) {
  if (!distinct_id && !user_id) return;
  posthog.identify(distinct_id ?? user_id, { email: getFirst(user_data?.email) });
}
