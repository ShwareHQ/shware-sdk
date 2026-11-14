---
'@shware/analytics': minor
---

`ServerEvent` takes an optional `platform` and `environment`, what the server knows from the payment itself (a Stripe payment is `web`, a store's sandbox purchase is `development`), and `track.resolveUser` now receives the event as its second argument: a host can prefer a session of the event's platform, answer the event's platform and environment from it, or answer for a user with no session from the account alone.
