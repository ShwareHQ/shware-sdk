import { posthog } from 'posthog-js';
import type { UpdateVisitorDTO } from '../schema/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { Integration } from './integration';

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
}

/**
 * Identifies the visitor to PostHog as the signed-in user, by the user's id — the server's
 * `distinct_id` for the visitor once someone has signed in on it. Only a user: identifying an
 * anonymous visitor by its own id would make PostHog treat it as an identified person, and
 * PostHog does not merge one identified person into another when the user later signs in, so the
 * pre-sign-in events would stay split off.
 *
 * Without a user it is sign-out (`reset()`): PostHog's identity is reset, so the next person on
 * this page starts anonymous instead of merging into the one who left.
 */
export function setPosthogUser({ user_id, user_data }: Omit<UpdateVisitorDTO, 'tags'>) {
  if (!user_id) {
    posthog.reset();
    return;
  }
  posthog.identify(user_id, { email: getFirst(user_data?.email) });
}

/** PostHog (posthog-js, initialized by the host): every event, for behavior analysis. */
export function posthogAnalytics(): Integration {
  return {
    type: 'analytics',
    track: sendPosthogEvent,
    setUser: setPosthogUser,
  };
}
