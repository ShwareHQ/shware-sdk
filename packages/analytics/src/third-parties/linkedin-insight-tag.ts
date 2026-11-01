import type { UpdateVisitorDTO } from '../schema/index';
import type { Lintrk } from '../track/lintrk';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { Integration } from './integration';

declare global {
  interface Window {
    /** Undefined until the LinkedIn Insight Tag script has loaded. */
    lintrk?: Lintrk['lintrk'];
  }
}

/**
 * Event name → LinkedIn conversion id, e.g. `{ purchase: 123, sign_up: 456 }`. Keys are the
 * names `track` accepts, so with strict event names a typo or undeclared event is a compile error.
 */
export type LinkedinConversionConfig = { readonly [K in TrackName]?: number };

export function sendLinkedinEvent(config: LinkedinConversionConfig) {
  return <T extends EventName>(
    name: TrackName<T>,
    _properties?: TrackProperties<T>,
    event_id?: string
  ) => {
    if (typeof window === 'undefined' || !window.lintrk) {
      console.warn('lintrk has not been initialized');
      return false;
    }
    if (window.location.host.includes('127.0.0.1')) return;
    if (window.location.host.includes('localhost')) return;

    const conversion_id = config[name];
    if (!conversion_id) return;
    window.lintrk('track', { conversion_id, event_id });
  };
}

export function setLinkedinUser({ user_data }: UpdateVisitorDTO) {
  if (typeof window === 'undefined' || !window.lintrk) {
    console.warn('lintrk has not been initialized');
    return;
  }

  const email = getFirst(user_data?.email);
  if (!email) return;
  window.lintrk('setUserData', { email });
}

/**
 * LinkedIn Insight Tag: only the events in `conversions`, each sent as the conversion id it maps
 * to (LinkedIn conversions are created in Campaign Manager and addressed by id).
 */
export function linkedInAds(options: {
  partnerId: `${number}`;
  conversions: LinkedinConversionConfig;
}): Integration {
  return {
    type: 'ads',
    track: sendLinkedinEvent(options.conversions),
    setUser: setLinkedinUser,
    script: {
      id: 'linkedin-insight-tag',
      inline: `
        _linkedin_partner_id = ${JSON.stringify(options.partnerId)};
        window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
        window._linkedin_data_partner_ids.push(_linkedin_partner_id);
        (function(l) {
          if (!l){
            window.lintrk = function(a,b){
              window.lintrk.q.push([a,b])
            };
            window.lintrk.q=[]
          }
          var s = document.getElementsByTagName("script")[0];
          var b = document.createElement("script");
          b.type = "text/javascript";b.async = true;
          b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
          s.parentNode.insertBefore(b, s);
        })(window.lintrk);
      `,
    },
  };
}
