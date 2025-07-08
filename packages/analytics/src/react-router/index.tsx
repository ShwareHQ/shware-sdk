import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { onLCP, onCLS, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { mapFBEvent } from '../track/fbq';
import { track } from '../track/index';
import type { Pixel, PixelId } from '../track/fbq';
import type { Gtag, GaId, GtmId } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

function useReportWebVitals(reportWebVitalsFn: (metric: Metric) => void) {
  useEffect(() => {
    onCLS(reportWebVitalsFn);
    onLCP(reportWebVitalsFn);
    onINP(reportWebVitalsFn);
    onFCP(reportWebVitalsFn);
    onTTFB(reportWebVitalsFn);
  }, [reportWebVitalsFn]);
}

declare global {
  interface Window extends Gtag, Pixel {}
}

interface Props {
  gaId?: GaId;
  gtmId?: GtmId;
  pixelId?: PixelId;
  facebookAppId?: string;
  nonce?: string;
  debugMode?: boolean;
  reportWebVitals?: boolean;
}

export function sendGAEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('gtag has not been initialized');
    return;
  }
  window.gtag('event', name, properties);
}

export function sendFBEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  event_id?: string
) {
  if (typeof window === 'undefined' || !window.fbq) {
    console.warn('fbq has not been initialized');
    return;
  }
  const { fbq } = window;
  const options = { eventID: event_id };
  const [type, fbEventName, fbEventProperties] = mapFBEvent(name, properties);
  if (type === 'track') {
    fbq(type, fbEventName, fbEventProperties, options);
  } else {
    fbq(type, fbEventName, fbEventProperties, options);
  }
}

export function Analytics({
  gaId,
  nonce,
  debugMode,
  pixelId,
  facebookAppId,
  reportWebVitals = true,
}: Props) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();

  useEffect(() => {
    const properties = {
      pathname,
      referrer: document.referrer,
      fbclid: params.get('fbclid'),
      gclid: params.get('gclid'),
      gad_source: params.get('gad_source'),
      gad_campaignid: params.get('gad_campaignid'),
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
    };

    /**
     * Pixel:
     * Each time the Pixel loads, it automatically calls fbq('track', 'PageView') to track a
     * PageView standard event.
     */
    track('page_view', properties, { enableThirdPartyTracking: false });
  }, [pathname, params]);

  useReportWebVitals((metric) => {
    if (!reportWebVitals) return;
    const properties = {
      id: metric.id,
      rating: metric.rating,
      value: metric.value,
      delta: metric.delta,
      navigation_type: metric.navigationType,
      non_interaction: true, // avoids affecting bounce rate.
    };
    track(metric.name, properties);
  });

  return (
    <>
      {facebookAppId && <meta property="fb:app_id" content={facebookAppId} />}
      {gaId && (
        <>
          <script
            async
            id="gtag"
            nonce={nonce}
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          />
          <script
            async
            nonce={nonce}
            id="gtag-init"
            dangerouslySetInnerHTML={{
              __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gaId}'${debugMode ? " ,{ 'debug_mode': true }" : ''});
            `,
            }}
          />
        </>
      )}
      {pixelId && (
        <>
          <script
            id="pixel"
            dangerouslySetInnerHTML={{
              __html: `
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
              fbq('init', '${pixelId}');
              fbq('track', 'PageView');`,
            }}
          />
        </>
      )}
    </>
  );
}
