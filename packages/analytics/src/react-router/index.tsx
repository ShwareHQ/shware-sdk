import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { onLCP, onFID, onCLS, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { track } from '../track/index';
import { mapAndSendFbqEvent } from '../track/fbq';
import type { Gtag, GaId, GtmId } from '../track/gtag';
import type { Fbq, PixelId } from '../track/fbq';
import type { EventName, TrackName, TrackProperties } from '../track/types';

function useReportWebVitals(reportWebVitalsFn: (metric: Metric) => void) {
  useEffect(() => {
    onCLS(reportWebVitalsFn);
    onFID(reportWebVitalsFn);
    onLCP(reportWebVitalsFn);
    onINP(reportWebVitalsFn);
    onFCP(reportWebVitalsFn);
    onTTFB(reportWebVitalsFn);
  }, [reportWebVitalsFn]);
}

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
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('gtag has not been initialized');
    return;
  }
  window.gtag('event', name, properties);
}

export function sendFbqEvent<T extends EventName>(
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
  const { pathname } = useLocation();
  const [params] = useSearchParams();

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

    /**
     * Pixel:
     * Each time the Pixel loads, it automatically calls fbq('track', 'PageView') to track a
     * PageView standard event.
     */
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
    track(metric.name as Lowercase<string>, properties);
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
    </>
  );
}
