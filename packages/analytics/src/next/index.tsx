'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import Script from 'next/script';
import { useEffect } from 'react';
import { track } from '../track/index';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import type { Gtag } from '../track/gtag';

declare global {
  interface Window extends Gtag {}
}

interface Props {
  gaId?: string;
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

export function Analytics({ gaId, nonce, debugMode }: Props) {
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
    track(metric.name as Lowercase<string>, properties);
  });

  return (
    <>
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
    </>
  );
}
