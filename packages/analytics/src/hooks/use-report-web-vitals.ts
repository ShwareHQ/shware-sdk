import { useEffect, useEffectEvent } from 'react';
import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

export function useReportWebVitals(reportWebVitalsFn: (metric: Metric) => void) {
  // Callers (e.g. `Analytics`) pass an inline callback and re-render on every
  // navigation, and the published build is not React Compiler output, so the
  // reference changes each render. web-vitals offers no way to unsubscribe, so
  // subscribe once per mount and always forward to the latest callback.
  const report = useEffectEvent((metric: Metric) => reportWebVitalsFn(metric));

  useEffect(() => {
    onCLS(report);
    onLCP(report);
    onINP(report);
    onFCP(report);
    onTTFB(report);
  }, []);
}
