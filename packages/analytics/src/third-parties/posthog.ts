import { posthog } from 'posthog-js';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { VisitorIdentity } from '../visitor/types';

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

/**
 * Identify the visitor to PostHog as the person the server says it is — `distinct_id`, the user's
 * id once someone has signed in. Only then: identifying an anonymous visitor by its own id would
 * make PostHog treat it as an identified person, and PostHog does not merge one identified person
 * into another when the user later signs in, so the pre-sign-in events would stay split off.
 */
export function setPosthogUser({ user_id, distinct_id, user_data }: VisitorIdentity) {
  if (!user_id) return;
  posthog.identify(distinct_id ?? user_id, { email: getFirst(user_data?.email) });
}
