import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { onLCP, onFID, onCLS, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { track } from '../track/index';

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

export function Analytics() {
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

  return null;
}
