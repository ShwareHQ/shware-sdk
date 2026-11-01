import type { EventName, ThirdPartyTracker, TrackName } from '../track/types';
import type { ThirdPartyUserSetter } from '../visitor/types';

/**
 * The one script an integration puts on the page, rendered by `<Analytics integrations>`
 * (react, next) with the request's `nonce`: an inline snippet that loads the
 * vendor's own script from its host, as every vendor's official snippet does.
 */
export interface IntegrationScript {
  /** The element id; also its React key, and how a test or a CSP report finds it. */
  readonly id: string;
  readonly inline: string;
  /** `next/script`'s loading strategy, `afterInteractive` by default; the other frameworks ignore it. */
  readonly strategy?: 'beforeInteractive' | 'afterInteractive' | 'lazyOnload';
}

/**
 * One third party, configured in one place: how events reach it, how it learns the signed-in
 * user, and the script it needs. Built by the factories in `@shware/analytics/third-parties`
 * (`googleAnalytics`, `metaAds`, …) and handed to both `setupAnalytics({ integrations })` and
 * `<Analytics integrations>`. A host can write its own for a platform the SDK does not cover.
 *
 * `type` says what the platform is for. An `analytics` integration (GA4, PostHog) receives every
 * event, for behavior analysis. An `ads` integration receives only what helps an ad platform
 * optimize and build audiences — the conversion events it maps to its own standard events, plus
 * the custom events it was explicitly given — and filters in its own `track`.
 */
export interface Integration {
  readonly type: 'analytics' | 'ads';
  readonly track: ThirdPartyTracker;
  readonly setUser?: ThirdPartyUserSetter;
  readonly script?: IntegrationScript;
  /**
   * Origins `<Analytics>` preconnects to (`react-dom`'s `preconnect`), so the connection is up
   * before the script asks for something there — e.g. where a snippet loads its library from.
   */
  readonly preconnect?: readonly string[];
}

/**
 * The GA4 recommended events that are conversions or close to one, for an ad platform with no
 * standard events of its own to map to (Microsoft UET), so it is not sent the whole product.
 */
export const CONVERSION_EVENTS = [
  'sign_up',
  'login',
  'generate_lead',
  'view_item',
  'add_to_cart',
  'add_to_wishlist',
  'begin_checkout',
  'add_payment_info',
  'purchase',
  'subscribe',
  'trial_begin',
  'search',
  'schedule',
  'submit_application',
  'contact',
] as const satisfies readonly EventName[];

export interface AdsOptions {
  /**
   * Custom events this platform receives besides the conversions it maps to its standard
   * events, e.g. one used as an optimization goal or for an audience. Everything else is not
   * sent to it. The names `track` accepts, so with strict event names a typo is a compile error.
   */
  customEvents?: readonly TrackName[];
}

/**
 * Which events an ad platform receives: what `isStandard` accepts — the events its mapper turns
 * into one of its standard events — and the custom events the host listed. Everything else in the
 * product (feature use, clicks, onboarding steps) is behavior analysis, which is GA4's and
 * PostHog's job, and only noise to an ad platform's optimization. The same rule picks what the
 * browser tag and the platform's conversions API send (`@shware/analytics/server`), so the two
 * report the same events.
 */
export function adEvents(
  isStandard: (name: string) => boolean,
  customEvents: readonly string[] = []
): (name: string) => boolean {
  return (name) => isStandard(name) || customEvents.includes(name);
}

/** An ad tracker that sends only the events `accepts` lets through (`adEvents`). */
export function adsTracker(
  send: ThirdPartyTracker,
  accepts: (name: string) => boolean
): ThirdPartyTracker {
  return (name, properties, eventId) => {
    if (!accepts(name)) return;
    return send(name, properties, eventId);
  };
}
