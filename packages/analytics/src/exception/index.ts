import { config } from '../setup/index';

/**
 * Sends an error to the error tracking of every integration that has one
 * (`Integration.captureException`): PostHog's, on the web (`posthogAnalytics` from
 * `@shware/analytics/third-parties`) and in an app (`@shware/analytics/native/posthog`). For code
 * shared by both, such as an API client reporting a request that failed unexpectedly: this entry
 * point imports neither PostHog library, so each platform's bundle gets only its own, through the
 * integration the host set up.
 *
 * A no-op before `setupAnalytics` and without such an integration. Never throws: reporting an
 * error must not become a second one where it is called.
 */
export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  for (const integration of config.integrations) {
    try {
      integration.captureException?.(error, properties);
    } catch (e: unknown) {
      console.error('captureException: the error was not reported', e);
    }
  }
}
