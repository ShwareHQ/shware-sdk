---
'@shware/http': minor
---

Add the `sessionRenewal({ auth })` Hono middleware, which passes every response through `auth.renew` so the session cookie slides with the session.
