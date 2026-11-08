---
'@shware/http': patch
---

Read the Cloudflare client IP from `cf-connecting-ip` first and fall back to `true-client-ip`: `true-client-ip` is only set by the edge on Enterprise zones with that feature enabled and otherwise passes through from the client, so preferring it let a client spoof the IP used by `getGeolocation`, the hono `geolocation` helper and the `rateLimit` middleware's default identifier.
