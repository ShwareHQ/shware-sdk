---
'@shware/purchase': minor
---

Add `plans` / `billingPeriods` to `StripeConfig.create` and `StripeConfig.comparePlans`, which says whether a switch between two subscription products is an upgrade, a downgrade, or a longer or shorter period of the same plan; and the interface of `createPlanChange` (types and `PlanChangeError`, not yet implemented).
