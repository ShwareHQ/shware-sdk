import type { UpdateVisitorDTO } from '../schema/index';
import type { GaId, Gtag } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { Integration } from './integration';

declare global {
  interface Window {
    /** Undefined until the Google tag (gtag.js) script has loaded. */
    gtag?: Gtag['gtag'];
  }
}

export function sendGAEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('GA has not been initialized');
    return false;
  }
  window.gtag('event', name, properties);
}

export function setGAUser({ user_id, user_data }: UpdateVisitorDTO) {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('GA has not been initialized');
    return;
  }
  // No user is sign-out (`reset()`): GA keeps a set user_id for every later event on the page, so
  // it is cleared explicitly.
  window.gtag('set', 'user_id', user_id || null);
  if (user_data) window.gtag('set', 'user_data', user_data);
}

/**
 * Google Analytics 4 (gtag.js): every event, for behavior analysis. `src` serves gtag.js from
 * another path (a first-party proxy); `debug` turns on GA4's DebugView for this page.
 */
export function googleAnalytics(options: { id: GaId; src?: string; debug?: boolean }): Integration {
  const src = options.src ?? `https://www.googletagmanager.com/gtag/js?id=${options.id}`;
  return {
    type: 'analytics',
    track: sendGAEvent,
    setUser: setGAUser,
    script: {
      id: 'gtag',
      inline: `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', ${JSON.stringify(options.id)}${options.debug ? ', { debug_mode: true }' : ''});
        (function (d, s, u) {
          var j = d.createElement(s);
          j.async = true;
          // A script added here does not inherit the nonce: hand it this one's, or a CSP that
          // allows scripts by nonce (without 'strict-dynamic') blocks gtag.js.
          j.nonce = d.currentScript && d.currentScript.nonce;
          j.src = u;
          var f = d.getElementsByTagName(s)[0];
          f.parentNode.insertBefore(j, f);
        })(document, 'script', ${JSON.stringify(src)});
      `,
    },
  };
}
