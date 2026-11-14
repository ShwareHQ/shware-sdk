---
'@shware/analytics': minor
---

`ServerEvent` takes an optional `platform` and `environment`, which win over the resolved session's: the server knows a Stripe payment is `web` and a store's sandbox purchase is `development` better than the user's latest session does. `track.resolveUser` now receives the event as its second argument, so a host can prefer a session of the event's platform, or answer for a user with no session from the account alone.
