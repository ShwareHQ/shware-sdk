import type { UpdateVisitorDTO } from '../schema/index';
import { type FBQ, type PixelId, isStandardFBEvent, mapFBEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import { type AdsOptions, type Integration, adEvents, adsTracker } from './integration';

declare global {
  interface Window {
    /** Undefined until the Meta Pixel script has loaded. */
    fbq?: FBQ['fbq'];
  }
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendFBEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  event_id?: string
) {
  if (typeof window === 'undefined' || !window.fbq) {
    console.warn('fbq has not been initialized');
    return false;
  }
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  const options = { eventID: event_id };
  const [type, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  // The two branches are identical on purpose. `fbq` is overloaded per `type` — 'track' takes a
  // standard event name with its typed properties, 'trackCustom' an arbitrary string — and what
  // `mapFBEvent` returns is a union of both shapes. Narrowing `type` is what picks a single
  // overload; collapsing the branches leaves the call matching none of them.
  if (type === 'track') {
    window.fbq(type, fbEventName, fbEventProperties, options);
  } else {
    window.fbq(type, fbEventName, fbEventProperties, options);
  }
}

export function setFBUser(pixelId: PixelId) {
  return ({ user_id, user_data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.fbq) {
      console.warn('fbq has not been initialized');
      return;
    }

    const address = getFirst(user_data?.address);

    window.fbq('init', pixelId, {
      em: getFirst(user_data?.email),
      fn: address?.first_name,
      ln: address?.last_name,
      ph: getFirst(user_data?.phone_number),
      external_id: user_id,
      ct: address?.city,
      // `st` is Meta's state/province field, not the street address.
      st: address?.region,
      zp: address?.postal_code,
      country: address?.country,
    });
  };
}

/** Meta Pixel: the events `mapFBEvent` maps to a Meta standard event, and `customEvents`. */
/** Meta's configuration, shared by `metaAds` in the browser and `metaConversions` on the server. */
export interface MetaAdsOptions extends AdsOptions {
  pixelId: PixelId;
}

export function metaAds(options: MetaAdsOptions): Integration {
  return {
    type: 'ads',
    track: adsTracker(sendFBEvent, adEvents(isStandardFBEvent, options.customEvents)),
    setUser: setFBUser(options.pixelId),
    script: {
      id: 'meta-pixel',
      inline: `
        !(function (f, b, e, v, n, t, s) {
          if (f.fbq) return;
          n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = !0;
          n.version = '2.0';
          n.queue = [];
          t = b.createElement(e);
          t.async = !0;
          t.src = v;
          s = b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t, s);
        })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', ${JSON.stringify(options.pixelId)});
        fbq('track', 'PageView');
      `,
    },
  };
}
