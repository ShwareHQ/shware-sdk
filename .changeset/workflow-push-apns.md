---
'@shware/workflow': minor
---

iOS pushes without Firebase: `@shware/workflow/apns` (`ApnsPushSender`: token-based APNs provider API, the `.p8` key ES256-signed with WebCrypto, dead tokens reported through `onUnregistered`) and `routeByPlatform({ ios, android }, store)` to pick the outlet from the profile's `push_platform`. APNs is HTTP/2-only and `wrangler dev`'s workerd cannot make an HTTP/2 subrequest (a deployed Worker can), so `@shware/workflow/apns-relay` (`startApnsRelay`, Node) forwards local sends; the sender's `origin` points at it.
