import type {
  CaptureResult,
  ExceptionAutoCaptureConfig,
  PostHog,
  PostHogConfig,
  Properties,
} from '@posthog/types';
import type { UpdateVisitorDTO } from '../schema/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { Integration } from './integration';

export type { PostHog, PostHogConfig } from '@posthog/types';

/**
 * `window.posthog`, for calls that return nothing (`capture`, `identify`, `onFeatureFlags`, …):
 * the snippet's stub until the library loads, which queues them and replays them in order once it
 * has. A method that returns a value returns `undefined` on the stub — use `getLoadedPosthog` for
 * those. `undefined` on the server and before the snippet has run.
 *
 * Read off `window` rather than declared on it, so a host that also has `posthog-js`'s own types
 * does not get two conflicting declarations. The types come from `@posthog/types`, PostHog's
 * types-only package for the snippet, so the host installs nothing for them.
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
 * after it with `useFeatureFlagVariantKey` / `getLoadedPosthog`, which are `undefined` in that
 * case. One promise per page, so React's `use()` can suspend on it:
 *
 * ```tsx
 * function Checkout() {
 *   use(browser()); // react-dom: the server renders the <Suspense> fallback instead
 *   use(posthogFlagsReady());
 *   return useFeatureFlagVariantKey('new-checkout') === 'test' ? <NewCheckout /> : <OldCheckout />;
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
 * Sends an error to PostHog's error tracking (`captureException`), as `sendPosthogEvent` does an
 * event: queued on the snippet's stub until the library loads, so it can be called from anywhere
 * at any time — an http client's error hook, a `catch` that recovers but should still be known.
 * Returns the `$exception` event, `undefined` while only the stub is there (or without PostHog).
 *
 * Never throws: reporting an error must not become a second one where it is called. The
 * `errorTracking` filter of `posthogAnalytics` applies, as to every exception.
 */
export function capturePosthogException(
  error: unknown,
  properties?: Properties
): CaptureResult | undefined {
  try {
    return getPosthog()?.captureException(error, properties);
  } catch (e: unknown) {
    console.error('capturePosthogException: the error was not reported', e);
    return undefined;
  }
}

/** A substring of what it is matched against, or a regular expression tested on it. */
export type ErrorPattern = string | RegExp;

export interface PosthogErrorTrackingOptions {
  /**
   * The library's exception autocapture: window errors and unhandled rejections, on by default.
   * The same as `config.capture_exceptions`, which wins when both are set.
   */
  autocapture?: boolean | ExceptionAutoCaptureConfig;
  /**
   * Exceptions not sent, as Sentry's `ignoreErrors`: matched against `Type: message` and the
   * message alone of each error in the chain (`$exception_list`), e.g. `'UET is not defined'` for an
   * ad blocker stubbing a tag. Errors thrown by browser extensions need no entry: PostHog drops them
   * itself (`error_tracking.captureExtensionExceptions`).
   */
  ignoreErrors?: readonly ErrorPattern[];
  /**
   * Exceptions not sent by where they were thrown, as Sentry's `denyUrls`: matched against the
   * file of the error's innermost frame, e.g. `'/gsi/client'` for Google One Tap's own minified
   * errors, whose messages change with every build. An error of yours that only passed through
   * such a script (a callback it called) is still sent.
   */
  denyUrls?: readonly ErrorPattern[];
}

/**
 * A pattern as JSON: a regular expression by its source and flags, rebuilt in the snippet. `g`
 * and `y` are dropped: they make `test` resume from the last match, so one rule would match the
 * same message only every other time.
 */
type SerializedPattern = string | { source: string; flags: string };

function serializePatterns(patterns: readonly ErrorPattern[] = []): SerializedPattern[] {
  return patterns.map((p) =>
    typeof p === 'string' ? p : { source: p.source, flags: p.flags.replace(/[gy]/g, '') }
  );
}

/**
 * The snippet's `before_send`, as source: `config` goes to `posthog.init` as JSON, which drops
 * functions, so the filter is written into the inline script instead — in place from the first
 * event, with no window before the app's bundle could install it. ES5, as the rest of the snippet.
 * Called with the rules (`off`, `errors`, `urls`); returns the `before_send` function.
 */
const EXCEPTION_FILTER = `function(r){
  function compile(ps){var o=[];for(var i=0;i<ps.length;i++){var p=ps[i];o.push(typeof p==="string"?p:new RegExp(p.source,p.flags))}return o}
  function any(ps,t){if(!t)return false;for(var i=0;i<ps.length;i++){var p=ps[i];if(typeof p==="string"?t.indexOf(p)!==-1:p.test(t))return true}return false}
  var errors=compile(r.errors),urls=compile(r.urls);
  return function(e){
    if(!e||e.event!=="$exception")return e;
    if(r.off)return null;
    var l=(e.properties&&e.properties.$exception_list)||[];
    for(var i=0;i<l.length;i++){var x=l[i]||{},v=x.value||"";if(any(errors,x.type?x.type+": "+v:v)||any(errors,v))return null}
    var f=l[0]&&l[0].stacktrace&&l[0].stacktrace.frames,u=f&&f.length?f[f.length-1].filename:"";
    return any(urls,u)?null:e;
  };
}`;

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
  /**
   * PostHog's error tracking. `true` or options turn on exception autocapture and filter what is
   * sent (`ignoreErrors`, `denyUrls`); `false` sends no exception at all, autocaptured or
   * reported (`capturePosthogException`, `PosthogErrorBoundary`, `setupPosthogReactErrorHandler`) — for
   * local development, which would otherwise fill the production project's issues. Left out, the
   * library's own `config` decides, as before. Each exception carries the session id, so its issue
   * links to the session's replay.
   */
  errorTracking?: boolean | PosthogErrorTrackingOptions;
}): Integration {
  // Where the snippet loads `array.js` from, by its own rule; a relative `api_host` (a reverse
  // proxy on the site's origin) needs no preconnect.
  const assets = options.config.api_host.replace('.i.posthog.com', '-assets.i.posthog.com');
  // `<` escaped: `config` is arbitrary JSON (a `bootstrap` can carry user data, a pattern any
  // text), and a `</script>` inside it would end this inline script early. `\u003c` parses back
  // to the same value.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const token = JSON.stringify(options.token);
  const { errorTracking } = options;
  let init = `posthog.init(${token}, ${json(options.config)});`;
  if (errorTracking !== undefined) {
    const tracking = typeof errorTracking === 'object' ? errorTracking : {};
    const config = {
      ...options.config,
      capture_exceptions:
        options.config.capture_exceptions ?? (errorTracking && (tracking.autocapture ?? true)),
    };
    const rules = {
      off: !errorTracking,
      errors: serializePatterns(tracking.ignoreErrors),
      urls: serializePatterns(tracking.denyUrls),
    };
    // In a function, so `c` does not become a global of this classic script.
    init = `!function(){var c=${json(config)};c.before_send=(${EXCEPTION_FILTER})(${json(rules)});posthog.init(${token}, c)}();`;
  }
  return {
    type: 'analytics',
    track: sendPosthogEvent,
    setUser: setPosthogUser,
    preconnect: URL.canParse(assets) ? [new URL(assets).origin] : [],
    script: {
      id: 'posthog-snippet',
      // The stub must exist before hydration, whose effects already track (`page_view`) and
      // identify; it is a few lines, and `array.js` still loads async. PostHog's own Next example
      // does the same. The snippet is PostHog's current one, verbatim
      // (posthog.com/docs/error-tracking/installation/web): it leaves an already loaded library in
      // place, inserts `array.js` once, and retries it on the next `init` if it failed to load.
      strategy: 'beforeInteractive',
      inline: `
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
        ${init}
      `,
    },
  };
}
