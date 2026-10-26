---
'@shware/purchase': minor
---

New `SUBSCRIPTION_STATUSES` value `BILLING_RETRY` for the App Store's billing retry without a grace period (status 3), where the customer is not served; `PAST_DUE` stays Stripe only and `ON_HOLD` Play only. This replaces the 9.0.0 advice to map that Apple state to `ON_HOLD`: map `BILLING_RETRY` to `BILLING_RETRY`. `AVAILABLE_STATUSES` is unchanged from 9.0.0 (`ACTIVE`, `TRIALING`, `IN_GRACE_PERIOD`, `PAST_DUE`).
