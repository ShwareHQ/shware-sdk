---
'@shware/analytics': patch
---

Take the PostHog types (`PostHog`, `PostHogConfig` and those of the hooks and the error boundary) from `@posthog/types`, PostHog's types-only package for the snippet, now a dependency, instead of the optional `posthog-js` peer: a host no longer installs `posthog-js` for them, and one without it no longer gets them as `any`.
