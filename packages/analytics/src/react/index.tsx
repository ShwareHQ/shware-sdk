import { useOutboundClickAnalytics } from '../hooks/use-outbound-click-analytics';
import { useReportWebVitals } from '../hooks/use-report-web-vitals';
import { useUETIdSync } from '../hooks/use-uet-id-sync';
import { useWebAnalytics } from '../hooks/use-web-analytics';
import {
  type AnalyticsProps,
  IntegrationScripts,
  preconnectIntegrations,
} from '../third-parties/analytics-props';
import { uetCustomerIdOf } from '../third-parties/microsoft-uet';
import { track } from '../track/index';

interface Props extends AnalyticsProps {
  /** The router's current path; a change reports a page view. */
  pathname: string;
  /** The router's current query string, with or without the leading `?`. */
  search: string;
}

/**
 * `<Analytics>` for any React router (TanStack Router, React Router, …): the host passes the
 * current location, e.g. `useLocation()`'s `pathname` and `searchStr` / `search`.
 */
export function Analytics({
  pathname,
  search,
  integrations,
  facebookAppId,
  nonce,
  reportWebVitals = true,
}: Props) {
  useWebAnalytics(pathname, search);
  useOutboundClickAnalytics();
  useUETIdSync(uetCustomerIdOf(integrations));
  preconnectIntegrations(integrations);

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
      {facebookAppId && <meta property="fb:app_id" content={facebookAppId} />}
      <IntegrationScripts integrations={integrations} nonce={nonce} />
    </>
  );
}

export { useFeatureFlag } from './use-feature-flag';
