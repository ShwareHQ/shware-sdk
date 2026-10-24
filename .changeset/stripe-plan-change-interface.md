---
'@shware/purchase': major
---

`StripeConfig.create` now takes `namespace`, `plans` (lowest tier first) and `billingPeriods` (shortest first), all required, and infers its type parameters from them, so `StripeConfig.create<'io.example', Plan, BillingPeriod>({ ... })` becomes `StripeConfig.create({ namespace: 'io.example', plans: PLANS, billingPeriods: BILLING_PERIODS, ... })`; a config with no subscriptions passes empty arrays. Product ids outside the namespace and plans or periods not declared are refused at runtime as well. Adds `StripeConfig.comparePlans` (upgrade, downgrade, or a longer or shorter period of the same plan) and `createPlanChange`: preview, apply and cancel a Stripe subscription's switch to another subscription product, with Apple's timing by default (an upgrade now, anything else at the period end), 3DS through a pending update, card declines as `PlanChangeError` with `mapDecline`'s reason, and period-end changes as a two-phase subscription schedule.
