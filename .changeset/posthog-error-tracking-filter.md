---
'@shware/analytics': minor
---

`posthogAnalytics({ errorTracking })` turns on PostHog's exception autocapture and filters exceptions with `ignoreErrors` and `denyUrls`, as Sentry's options of the same names; the filter is written into the snippet, since `config` reaches `posthog.init` as JSON and drops a `before_send` function. `errorTracking: false` sends no exception, for local development. `capturePosthogException(error, properties?)` reports an error from anywhere, queued on the stub and never throwing.
