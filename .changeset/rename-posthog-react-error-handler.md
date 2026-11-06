---
'@shware/analytics': minor
---

Rename `setupReactErrorHandler` to `setupPosthogReactErrorHandler`, so the call site says it reports to PostHog, as `PosthogErrorBoundary` and `capturePosthogException` do.
