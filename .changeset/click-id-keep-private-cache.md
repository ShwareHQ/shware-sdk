---
'@shware/analytics': patch
---

`createClickIdMiddleware` no longer overrides the `Cache-Control` of a response that is already `private` or `no-store` when it attaches cookies: no shared cache can store such a response, so its per-user `Set-Cookie` is safe as it is, and a browser never replays a `Set-Cookie` from its own cache. The gtag.js loader served through a first-party Google Tag Gateway (`private, max-age=900`) keeps its browser caching while its requests still re-issue the cookies, where it used to become `no-store` for every visitor carrying one. Responses that could be shared (`public`, `s-maxage`, or no `Cache-Control`) are made uncacheable as before.
