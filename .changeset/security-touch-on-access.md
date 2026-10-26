---
'@shware/security': minor
---

`getPrincipal` and `isAuthenticated` now renew the session they authenticate (sliding expiration), so a user who keeps using the app is no longer signed out after `maxInactiveInterval` unless they also call `logged`. No extra read: the loaded session's `lastAccessedTime` is compared in memory, and writes are spaced by the new `AuthConfig.session.touchInterval` (seconds, default 3600), so an active session costs one write per interval.
