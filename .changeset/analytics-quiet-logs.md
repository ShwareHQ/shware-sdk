---
'@shware/analytics': patch
---

The `localStorage` fallback logs `console.warn` instead of `console.error`, since the in-memory store takes over, and the `track` catch blocks log at `warn` instead of `log`. The Meta Graph API and LinkedIn API version constants document the vendors' deprecation rhythm, and `linkedinConversions` accepts an optional `apiVersion` as `metaConversions` does.
