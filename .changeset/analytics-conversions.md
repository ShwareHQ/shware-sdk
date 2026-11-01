---
'@shware/analytics': minor
---

The server's Conversions APIs are configured once with `setupConversions({ destinations, track: { resolveUser, store } })`. The destinations come from `metaConversions`, `redditConversions`, `openaiConversions`, `linkedinConversions`, `microsoftConversions` and `googleAdsConversions`, which take the browser integrations' options (`MetaAdsOptions`, …) plus a token; any `{ send(events, data) }`, such as a CRM, is a destination too. It returns `forward(events, data)`, for the events a client sent, and `track(event)`, for server-only ones such as webhooks: `track.resolveUser` completes the event from the user's latest session, and `track.store` stores it and says whether it was new, so a redelivered webhook is not reported twice.

Through it a Conversions API receives the same events as its browser tag: the platform's standard events and the `customEvents` it lists, decided by the same rule (`adEvents`). The `send…Events` functions still send every event.

`forward` and `track` never throw, so reporting a conversion cannot fail the request it runs in, a payment webhook least of all: a destination that fails is logged with the ids of the events it lost, and the others are still sent to. The senders underneath no longer log and swallow a failed request: they reject with a `ConversionsApiError` (platform, status, body; never the token) or the network error, for a caller using them directly to handle.

`customEvents`, UET's `events`, the server's `LinkedinConversionConfig` (now the browser's typed one) and `GoogleAdsConversionConfig` are keyed by the names `track` accepts, so strict event names catch a typo in any of them; with strict event names on, an undeclared name in them no longer compiles.

The legacy Meta sender built on `facebook-nodejs-business-sdk`, its `@shware/analytics/server/legacy` entry and that peer dependency are removed: use `sendMetaEvents` (or `metaConversions`) from `@shware/analytics/server`, which sends the same payload.
