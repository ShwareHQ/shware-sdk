---
'@shware/http': patch
---

The Cloudflare geolocation reader no longer reads `true-client-ip` and takes the client IP from `cf-connecting-ip` only: `true-client-ip` is set by the edge only on Enterprise zones with that feature enabled and otherwise passes through from the client, so preferring it let a client spoof the IP used by `getGeolocation`, the hono `geolocation` helper and the `rateLimit` middleware's default identifier.
