'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import Script from 'next/script';
import { track } from '../track/index';
import { mapAndSendFbqEvent } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { Gtag, GaId, GtmId } from '../track/gtag';
import type { Fbq, PixelId } from '../track/fbq';

declare global {
  interface Window extends Gtag, Fbq {}
}

interface Props {
  gaId?: GaId;
  gtmId?: GtmId;
  pixelId?: PixelId;
  facebookAppId?: string;
  nonce?: string;
  debugMode?: boolean;
}

export function sendGAEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (!window.gtag) {
    console.warn('GA has not been initialized');
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
  mapAndSendFbqEvent(window.fbq, name, properties, { eventID: event_id });
}

export function Analytics({ gaId, nonce, debugMode, pixelId, facebookAppId }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    const properties = {
      pathname,
      referrer: document.referrer,
      gclid: params.get('gclid'),
      fbclid: params.get('fbclid'),
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
    };

    track('page_view', properties, { enableThirdPartyTracking: false });
  }, [pathname, params]);

  useReportWebVitals((metric) => {
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
          <Script
            id="gtag"
            nonce={nonce}
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          />
          <Script
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
          <Script
            id="pixel"
            strategy="afterInteractive"
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
          <noscript>
            <img
              width="1"
              height="1"
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}
    </>
  );
}
