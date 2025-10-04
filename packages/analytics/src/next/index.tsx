'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useReportWebVitals } from 'next/web-vitals';
import { usePageViewAnalytics } from '../hooks/use-page-view-analytics';
import { mapFBEvent } from '../track/fbq';
import { track } from '../track/index';
import type { Pixel, PixelId } from '../track/fbq';
import type { GaId, Gtag, GtmId } from '../track/gtag';
import type { EventName, TrackName, TrackProperties } from '../track/types';

type HotjarId = `${number}`;

declare global {
  interface Window extends Gtag, Pixel {}
}

interface Props {
  gaId?: GaId;
  gtmId?: GtmId;
  pixelId?: PixelId;
  hotjarId?: HotjarId;
  facebookAppId?: string;
  nonce?: string;
  debugMode?: boolean;
  reportWebVitals?: boolean;
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
  hotjarId,
  facebookAppId,
  reportWebVitals = true,
}: Props) {
  const pathname = usePathname();
  usePageViewAnalytics(pathname);

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
      )}
      {hotjarId && (
        <Script
          id="hotjar"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
            (function(h,o,t,j,a,r){
              h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
              h._hjSettings={hjid:${hotjarId},hjsv:6};
              a=o.getElementsByTagName('head')[0];
              r=o.createElement('script');r.async=1;
              r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
              a.appendChild(r);
            })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
            `,
          }}
        />
      )}
    </>
  );
}
