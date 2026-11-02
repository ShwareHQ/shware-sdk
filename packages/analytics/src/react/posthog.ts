import type { BootstrapConfig, FeatureFlagResult, JsonType, PostHog } from '@posthog/types';
import {
  type ReactNode,
  createContext,
  createElement,
  use,
  useRef,
  useSyncExternalStore,
} from 'react';
import { getLoadedPosthog, getPosthog } from '../third-parties/posthog';

const noop = () => {};

const Bootstrap = createContext<BootstrapConfig | undefined>(undefined);

/**
 * The counterpart of `posthog-js/react`'s `PostHogProvider`, for the snippet-loaded library. It
 * does not initialize PostHog — `posthogAnalytics` does — only carries what the hooks need from
 * the server: the request's server-evaluated flags, the same object as the snippet's
 * `config.bootstrap`, for the flag hooks to render with on the server, through hydration and until
 * the library has loaded its flags — an experiment's variant renders at once, with no flicker and
 * no hydration mismatch. Wrap the app in it, e.g. in the root route.
 */
export function PosthogProvider({
  bootstrap,
  children,
}: {
  bootstrap: BootstrapConfig | undefined;
  children: ReactNode;
}) {
  return createElement(Bootstrap.Provider, { value: bootstrap }, children);
}

/** Subscribes to flag (re)loads; on the stub the subscription is queued and has no unsubscribe. */
function subscribe(onChange: () => void): () => void {
  const unsubscribe: (() => void) | undefined = getPosthog()?.onFeatureFlags(onChange);
  return unsubscribe ?? noop;
}

/**
 * The loaded library's flag state, which `posthog-js/react` reads too: on the instance, but left
 * out of `@posthog/types`, whose `featureFlags` declares only the override methods.
 */
type LoadedPostHog = PostHog & {
  featureFlags: { hasLoadedFlags: boolean; getFlags(): string[] };
};

/**
 * What `read` returns once the library has loaded its flags, and `bootstrapped` until then and on
 * the server, re-read when flags reload. The value is kept while its JSON is unchanged, as
 * `useSyncExternalStore` needs: PostHog builds a new result or payload object on every read.
 */
function useFlags<T>(read: (posthog: LoadedPostHog) => T, bootstrapped: T): T {
  const cache = useRef<{ json: string | undefined; value: T }>(undefined);
  const stable = (value: T) => {
    // Typed wider: `JSON.stringify(undefined)` is `undefined`, whatever its type says.
    const json: string | undefined = JSON.stringify(value);
    if (!cache.current || cache.current.json !== json) cache.current = { json, value };
    return cache.current.value;
  };
  return useSyncExternalStore(
    subscribe,
    () => {
      const posthog = getLoadedPosthog() as LoadedPostHog | undefined;
      // As `posthog-js/react`: the bootstrap until the flags request has answered, not only until
      // the library has loaded, so no flag is read (and no exposure recorded) before then.
      return stable(posthog?.featureFlags.hasLoadedFlags ? read(posthog) : bootstrapped);
    },
    () => stable(bootstrapped)
  );
}

/*
 * The hooks of `posthog-js/react`, with its names and signatures, for the snippet-loaded library.
 *
 * Under a `<PosthogProvider>` each is the server's value until the library has loaded its
 * flags, on the server too. Without one it is `undefined` on the server and through hydration, so
 * the default renders first and the variant once flags arrive; to wait for them instead, call
 * `use(browser())` and `use(posthogFlagsReady())` above it, under a `<Suspense>`.
 *
 * Reading a flag records the exposure (`$feature_flag_called`) once the flags have loaded, as
 * PostHog's do — except the payload's — not while only a bootstrapped value is shown.
 */

/** A flag's value: `true`/`false`, a multivariate flag's variant, or `undefined` until loaded. */
export function useFeatureFlagVariantKey(flag: string): string | boolean | undefined {
  const bootstrapped = use(Bootstrap)?.featureFlags?.[flag];
  return useFlags((posthog) => posthog.getFeatureFlag(flag), bootstrapped);
}

/** Whether a flag is on (a variant counts as on); `defaultValue` while it is unknown. */
export function useFeatureFlagEnabled(flag: string): boolean | undefined;
export function useFeatureFlagEnabled(flag: string, defaultValue: boolean): boolean;
export function useFeatureFlagEnabled(flag: string, defaultValue?: boolean) {
  const value = use(Bootstrap)?.featureFlags?.[flag];
  const bootstrapped = value === undefined ? undefined : !!value;
  return useFlags((posthog) => posthog.isFeatureEnabled(flag), bootstrapped) ?? defaultValue;
}

/** A flag's payload, read without recording an exposure. */
export function useFeatureFlagPayload(flag: string): JsonType {
  const bootstrapped = use(Bootstrap)?.featureFlagPayloads?.[flag];
  return useFlags(
    (posthog) => posthog.getFeatureFlagResult(flag, { send_event: false })?.payload,
    bootstrapped
  );
}

/** A flag's value, variant and payload together; `undefined` while it is unknown. */
export function useFeatureFlagResult(flag: string): FeatureFlagResult | undefined {
  const bootstrap = use(Bootstrap);
  const value = bootstrap?.featureFlags?.[flag];
  const bootstrapped: FeatureFlagResult | undefined =
    value === undefined
      ? undefined
      : {
          key: flag,
          enabled: typeof value === 'string' ? true : value,
          variant: typeof value === 'string' ? value : undefined,
          payload: bootstrap?.featureFlagPayloads?.[flag],
        };
  return useFlags((posthog) => posthog.getFeatureFlagResult(flag), bootstrapped);
}

/**
 * The keys of the flags: only those that are on while bootstrapped, every flag the library has
 * once loaded — as `posthog-js/react`'s does.
 */
export function useActiveFeatureFlags(): string[] {
  const flags = use(Bootstrap)?.featureFlags ?? {};
  const bootstrapped = Object.keys(flags).filter((key) => flags[key]);
  return useFlags((posthog) => posthog.featureFlags.getFlags(), bootstrapped);
}

/**
 * `window.posthog`, as `posthog-js/react`'s `usePostHog`: the snippet's stub until the library
 * loads — which queues the calls returning nothing (`capture`, `identify`, …) — then the library,
 * re-rendering when it replaces the stub; `undefined` on the server. Use the value of the latest
 * render rather than one kept from before (e.g. in a ref): calls on a stub kept past the load are
 * lost. A method that returns a value returns `undefined` on the stub; read flags with the hooks.
 *
 * The re-render comes from the flags loading, as the library answers the stub's queued
 * `onFeatureFlags`: with feature flags disabled it stays on the stub until something else
 * re-renders.
 */
export function usePostHog(): PostHog | undefined {
  return useSyncExternalStore(subscribe, getPosthog, () => undefined);
}
