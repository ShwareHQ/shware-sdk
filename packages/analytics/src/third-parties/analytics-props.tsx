import type { Integration } from './integration';

/** The props every framework's `<Analytics>` takes (react, next). */
export interface AnalyticsProps {
  /** The integrations passed to `setupAnalytics`, whose scripts this renders. */
  integrations?: readonly Integration[];
  /** Renders `<meta property="fb:app_id">`, for Facebook's sharing insights. */
  facebookAppId?: string;
  /** The request's CSP nonce, set on every script rendered. */
  nonce?: string;
  /** Reports Core Web Vitals as events (on by default). */
  reportWebVitals?: boolean;
}

/**
 * The integrations' scripts as plain `<script>` elements, for the frameworks that render them as
 * they are (react).
 */
export function IntegrationScripts({
  integrations = [],
  nonce,
}: Pick<AnalyticsProps, 'integrations' | 'nonce'>) {
  return integrations
    .flatMap(({ script }) => (script ? [script] : []))
    .map((script) => (
      <script
        key={script.id}
        id={script.id}
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: script.inline }}
      />
    ));
}
