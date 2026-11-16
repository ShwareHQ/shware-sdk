---
'@shware/security': minor
---

`Auth.renew(request, response)` renews the session cookie (fresh `Max-Age`, the attributes its login wrote) on the request whose `getPrincipal` / `isAuthenticated` rewrote the session, so the cookie slides with the session instead of expiring `maxInactiveInterval` after sign-in.
