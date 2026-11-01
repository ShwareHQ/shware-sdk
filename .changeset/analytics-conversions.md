---
'@shware/analytics': minor
---

The server's Conversions APIs are configured once with `setupConversions({ destinations, track: { resolveUser, store } })`. The destinations come from `metaConversions`, `redditConversions`, `openaiConversions`, `linkedinConversions`, `microsoftConversions` and `googleAdsConversions`, which take the browser integrations' options (`MetaAdsOptions`, …) plus a token; any `{ send(events, data) }`, such as a CRM, is a destination too. It returns `forward(events, data)`, for the events a client sent, and `track(event)`, for server-only ones such as webhooks: `track.resolveUser` completes the event from the user's latest session, and `track.store` stores it before it is sent.

Through it a Conversions API receives the same events as its browser tag: the platform's standard events and the `customEvents` it lists, decided by the same rule (`adEvents`). The `send…Events` functions still send every event.

Failures are the caller's to handle. The senders no longer log and swallow a failed request: they reject with a `ConversionsApiError` (platform, status, body; never the token) or the network error. `forward` sends to every destination, then rejects with an `AggregateError` of those that failed; `track` rejects with that or with `resolveUser`'s or `store`'s error, so a webhook handler that lets it fail the request has the provider deliver it again, and the conversion is sent again — every platform deduplicates on the event id, and a custom destination must too.

`customEvents`, UET's `events`, the server's `LinkedinConversionConfig` (now the browser's typed one) and `GoogleAdsConversionConfig` are keyed by the names `track` accepts, so strict event names catch a typo in any of them; with strict event names on, an undeclared name in them no longer compiles.

The legacy Meta sender built on `facebook-nodejs-business-sdk`, its `@shware/analytics/server/legacy` entry and that peer dependency are removed: use `sendMetaEvents` (or `metaConversions`) from `@shware/analytics/server`, which sends the same payload.
