---
'@shware/purchase': minor
---

App Store `mapPaymentType` now labels an upgrade (`DID_CHANGE_RENEWAL_PREF` / `OFFER_REDEEMED` with subtype `UPGRADE`) `SUBSCRIPTION_UPDATE` instead of `SUBSCRIPTION_RENEWAL`, the label a change of plan gets on Stripe, so payment reports count plan changes the same way on every platform.
