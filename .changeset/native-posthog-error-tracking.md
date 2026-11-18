---
'@shware/analytics': minor
---

Add PostHog for React Native: `@shware/analytics/native/posthog` exports `posthogAnalytics` (an integration on the optional peer `posthog-react-native` that forwards every `track`, `identify` and `reset`, with `errorTracking` turning on the library's autocapture of uncaught errors and unhandled rejections, filtered by `ignoreErrors`, or sending no exception when `false`), `capturePosthogException`, `PosthogErrorBoundary` (the web boundary's props) and `getPosthog`.
