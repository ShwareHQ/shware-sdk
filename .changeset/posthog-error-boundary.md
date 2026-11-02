---
'@shware/analytics': minor
---

PostHog error tracking for the snippet-loaded library, as in `posthog-js/react`: `PosthogErrorBoundary` (its `PostHogErrorBoundary`'s props) sends a render error with its component stack and renders `fallback` instead, and `setupReactErrorHandler()` (without a client) reports from React 19's root error options.
