'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { useEffect } from 'react';
import { track } from '../index';

export function Analytics() {
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
    track(metric.name, {
      rating: metric.rating,
      navigation_type: metric.navigationType,
      non_interaction: true, // avoids affecting bounce rate.
      event_label: metric.id, // id unique to current page load
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value), // values must be integers
    });
  });

  return null;
}
