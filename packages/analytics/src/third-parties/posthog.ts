import type { PostHog, PostHogConfig } from 'posthog-js';
import type { UpdateVisitorDTO } from '../schema/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { Integration } from './integration';

export type { PostHog, PostHogConfig } from 'posthog-js';

/**
 * `window.posthog`, for calls that return nothing (`capture`, `identify`, `onFeatureFlags`, …):
 * the snippet's stub until the library loads, which queues them and replays them in order once it
 * has. A method that returns a value returns `undefined` on the stub — use `getLoadedPosthog` for
 * those. `undefined` on the server and before the snippet has run.
 *
 * Read off `window` rather than declared on it, so a host that also has `posthog-js`'s own types
 * does not get two conflicting declarations. Types only: install `posthog-js` (a dev dependency
 * is enough) for them; it is never bundled.
 */
export function getPosthog(): PostHog | undefined {
  if (typeof document === 'undefined') return undefined;
  return (window as { posthog?: PostHog }).posthog;
}

/**
 * The PostHog instance once the library has loaded, for the methods that return a value
 * (`getFeatureFlag`, `isFeatureEnabled`, `get_distinct_id`, …); `undefined` while only the stub is
 * there. To act when flags arrive, subscribe with `getPosthog()?.onFeatureFlags` instead, which
 * the stub queues.
 */
export function getLoadedPosthog(): PostHog | undefined {
  const posthog = getPosthog();
  return posthog?.__loaded ? posthog : undefined;
}

let flagsReady: Promise<void> | undefined;

/**
 * Resolves once PostHog has loaded its feature flags — or after `timeoutMs` (3 s by default),
 * since an ad blocker that stops the library would otherwise hold it forever; read the flags
 * after it with `useFeatureFlag` / `getLoadedPosthog`, which are `undefined` in that case. One
 * promise per page, so React's `use()` can suspend on it:
 *
 * ```tsx
 * function Checkout() {
 *   use(browser()); // react-dom: the server renders the <Suspense> fallback instead
 *   use(posthogFlagsReady());
 *   return useFeatureFlag('new-checkout') === 'test' ? <NewCheckout /> : <OldCheckout />;
 * }
 * ```
 *
 * Waiting shows the fallback until the flags are in, instead of the default then the variant;
 * with server-evaluated flags in `config.bootstrap` it resolves as soon as the library loads.
 * Browser only: it never resolves on the server.
 */
export function posthogFlagsReady(timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined') return new Promise(() => {});
  flagsReady ??= new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
    const posthog = getPosthog();
    if (!posthog) return;
    // Queued on the stub; once loaded, called as soon as flags are (or already were) in.
    posthog.onFeatureFlags(() => resolve());
  });
  return flagsReady;
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendPosthogEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  // `document`, not `window`: React Native defines `window` as an alias of `global`, so a
  // window check would pass there and then throw on `window.location`, which it has no such
  // alias for.
  if (typeof document === 'undefined') return;
  const posthog = getPosthog();
  if (!posthog) {
    console.warn('posthog has not been initialized');
    return false;
  }
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
  const posthog = getPosthog();
  if (!posthog) {
    console.warn('posthog has not been initialized');
    return;
  }
  if (!user_id) {
    posthog.reset();
    return;
  }
  posthog.identify(user_id, { email: getFirst(user_data?.email) });
}

/**
 * PostHog: every event, for behavior analysis. Loaded with PostHog's HTML snippet, which defines
 * a stub `window.posthog` and fetches the library (`array.js`) asynchronously from PostHog's
 * assets host, so it stays out of the app's bundle; calls made before it loads are queued.
 *
 * `config` is serialized into the snippet's `posthog.init` call, so only its JSON survives:
 * `api_host`, `defaults`, `bootstrap` (server-evaluated flags, so an experiment renders its variant
 * without a flicker), and the other plain options — functions such as `loaded` are dropped.
 */
export function posthogAnalytics(options: {
  token: `phc_${string}`;
  config: Partial<PostHogConfig> & { api_host: string };
}): Integration {
  // Where the snippet loads `array.js` from, by its own rule; a relative `api_host` (a reverse
  // proxy on the site's origin) needs no preconnect.
  const assets = options.config.api_host.replace('.i.posthog.com', '-assets.i.posthog.com');
  return {
    type: 'analytics',
    track: sendPosthogEvent,
    setUser: setPosthogUser,
    preconnect: URL.canParse(assets) ? [new URL(assets).origin] : [],
    script: {
      id: 'posthog',
      // The stub must exist before hydration, whose effects already track (`page_view`) and
      // identify; it is a few lines, and `array.js` still loads async. PostHog's own Next example
      // does the same.
      strategy: 'beforeInteractive',
      inline: `
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
        posthog.init(${JSON.stringify(options.token)}, ${JSON.stringify(options.config)});
      `,
    },
  };
}
