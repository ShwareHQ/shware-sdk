---
'@shware/analytics': patch
---

Quieter console output: a browser tracker whose script is blocked (`gtag`, `fbq`, `lintrk`, `uetq`, `oaiq`, `rdt`, `posthog`) warns "has not been initialized" once per page instead of on every event; the `localStorage` fallback warns once (`console.warn`, not `console.error`) since the in-memory store takes over; the `track` catch blocks log at `warn` instead of `log`. The Meta Graph API and LinkedIn API version constants document the vendors' deprecation rhythm, and `linkedinConversions` accepts an optional `apiVersion` as `metaConversions` does.
