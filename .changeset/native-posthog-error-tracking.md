---
'@shware/analytics': minor
---

Add PostHog for React Native: `@shware/analytics/native/posthog` exports `posthogAnalytics` (an integration on the optional peer `posthog-react-native` that forwards every `track`, `identify` and `reset`, with `errorTracking` turning on the library's autocapture of uncaught errors and unhandled rejections, filtered by `ignoreErrors`, or sending no exception when `false`), `capturePosthogException`, `PosthogErrorBoundary` and `getPosthog`; and add `captureException` to `@shware/analytics`, which reports an error to every integration with error tracking (`Integration.captureException`, now also set by the web `posthogAnalytics`), so code shared by the web and an app reports through one import.
