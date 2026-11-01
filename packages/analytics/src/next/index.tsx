'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useReportWebVitals } from 'next/web-vitals';
import { Suspense } from 'react';
import { useOutboundClickAnalytics } from '../hooks/use-outbound-click-analytics';
import { useUETIdSync } from '../hooks/use-uet-id-sync';
import { useWebAnalytics } from '../hooks/use-web-analytics';
import type { AnalyticsProps } from '../third-parties/analytics-props';
import { uetCustomerIdOf } from '../third-parties/microsoft-uet';
import { track } from '../track/index';

/**
 * Its own component under a Suspense boundary: `useSearchParams` in a statically rendered route
 * bails the whole tree out to client rendering unless something above it suspends, and Next
 * fails the build for a page that lets it. The boundary is here so a host does not have to know.
 */
function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useWebAnalytics(pathname, searchParams.toString());
  return null;
}

export function Analytics({
  integrations = [],
  facebookAppId,
  nonce,
  reportWebVitals = true,
}: AnalyticsProps) {
  useOutboundClickAnalytics();
  useUETIdSync(uetCustomerIdOf(integrations));

  useReportWebVitals((metric) => {
    if (!reportWebVitals) return;
    const properties = {
      value: metric.delta,
      metric_id: metric.id,
      metric_value: metric.value,
      metric_delta: metric.delta,
      metric_rating: metric.rating,
      metric_navigation_type: metric.navigationType,
      non_interaction: true, // avoids affecting bounce rate.
    };
    track(metric.name, properties);
  });

  return (
    <>
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
      {facebookAppId && <meta property="fb:app_id" content={facebookAppId} />}
      {integrations
        .flatMap(({ script }) => (script ? [script] : []))
        .map((script) => (
          <Script
            key={script.id}
            id={script.id}
            nonce={nonce}
            strategy={script.strategy ?? 'afterInteractive'}
            dangerouslySetInnerHTML={{ __html: script.inline }}
          />
        ))}
    </>
  );
}
