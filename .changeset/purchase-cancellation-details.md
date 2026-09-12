---
'@shware/purchase': minor
---

`CancellationDetails` is now a platform-neutral record exported from the package root (`initiator`, `reason`, `feedback`, `comment`, `resubscribeIntent`, plus any platform-specific string), with `CANCELLATION_INITIATORS` / `CANCELLATION_FEEDBACKS` / `RESUBSCRIBE_INTENTS` vocabularies, and each platform gets a `mapCancellationDetails`: Stripe from `cancellation_details`, Google Play from `canceledStateContext` (with `mapCanceledAt`), the App Store from the notification type, subtype and `expirationIntent`. The Stripe entry still re-exports the type.
