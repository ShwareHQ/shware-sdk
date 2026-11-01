import type { UpdateVisitorDTO } from '../schema/index';
import { type PixelId, type RDT, isStandardRDTEvent, mapRDTEvent } from '../track/rdt';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import { type AdsOptions, type Integration, adEvents, adsTracker } from './integration';

declare global {
  interface Window {
    /** Undefined until the Reddit Pixel script has loaded. */
    rdt?: RDT['rdt'];
  }
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export function sendRedditEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
) {
  if (typeof window === 'undefined' || !window.rdt) {
    console.warn('rdt has not been initialized');
    return false;
  }
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  const [type, params] = mapRDTEvent(name, properties, eventId);
  // The two branches are identical on purpose: `rdt('track', ...)` is overloaded — a standard
  // event name carries its own params type, 'Custom' carries `CustomEventParams` — and what
  // `mapRDTEvent` returns is a union of both. Narrowing `type` is what picks a single overload.
  if (type === 'Custom') {
    window.rdt('track', type, JSON.parse(JSON.stringify(params)));
  } else {
    window.rdt('track', type, JSON.parse(JSON.stringify(params)));
  }
}

export function setRedditUser(pixelId: PixelId) {
  return ({ user_id, user_data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.rdt) {
      console.warn('rdt has not been initialized');
      return;
    }

    window.rdt('init', pixelId, {
      email: getFirst(user_data?.email),
      phoneNumber: getFirst(user_data?.phone_number),
      externalId: user_id,
    });
  };
}

/** Reddit Pixel: the events `mapRDTEvent` maps to a Reddit standard event, and `customEvents`. */
/** Reddit's configuration, shared by `redditAds` and `redditConversions` on the server. */
export interface RedditAdsOptions extends AdsOptions {
  pixelId: PixelId;
}

export function redditAds(options: RedditAdsOptions): Integration {
  // As the Ads console's tag: the pixel loads with its id.
  const src = `https://www.redditstatic.com/ads/pixel.js?pixel_id=${encodeURIComponent(options.pixelId)}`;
  return {
    type: 'ads',
    track: adsTracker(sendRedditEvent, adEvents(isStandardRDTEvent, options.customEvents)),
    setUser: setRedditUser(options.pixelId),
    script: {
      id: 'reddit-pixel',
      inline: `
        !function(w,d) {
          if(!w.rdt) {
            var p = w.rdt = function() {
              p.sendEvent ? p.sendEvent.apply(p,arguments) : p.callQueue.push(arguments)
            };
            p.callQueue = [];
            var t = d.createElement("script");
            t.src = ${JSON.stringify(src)};
            t.async = !0;
            var s = d.getElementsByTagName("script")[0];
            s.parentNode.insertBefore(t,s)
          }
        }(window, document);
        rdt('init', ${JSON.stringify(options.pixelId)});
        rdt('track', 'PageVisit');
      `,
    },
  };
}
