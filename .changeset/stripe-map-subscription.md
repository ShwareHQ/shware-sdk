---
'@shware/purchase': minor
---

Add `mapSubscription` (a Stripe subscription in the platform-neutral row shape), `mapListPrice` and `cancellationComment` to `@shware/purchase/stripe`; `mapCancellationDetails` now splits a `[maybe]` / `[no]` / `[yes]` comment prefix back into `resubscribeIntent`.
