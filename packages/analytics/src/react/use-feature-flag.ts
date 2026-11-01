import { useSyncExternalStore } from 'react';
import { getLoadedPosthog, getPosthog } from '../third-parties/posthog';

const noop = () => {};

/** Subscribes to flag (re)loads; on the stub the subscription is queued and has no unsubscribe. */
function subscribe(onChange: () => void): () => void {
  const unsubscribe: (() => void) | undefined = getPosthog()?.onFeatureFlags(onChange);
  return unsubscribe ?? noop;
}

/**
 * A PostHog feature flag's value — `true`/`false`, a multivariate flag's variant, or `undefined`
 * until PostHog has loaded its flags — re-rendering when they reload (e.g. after `identify`).
 * `undefined` on the server and through hydration, so the server markup always matches.
 *
 * Renders the default first and the variant once flags arrive. To wait for them instead, call
 * `use(browser())` and `use(posthogFlagsReady())` above it, under a `<Suspense>`.
 */
export function useFeatureFlag(key: string): string | boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getLoadedPosthog()?.getFeatureFlag(key),
    () => undefined
  );
}
