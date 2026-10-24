---
'@shware/purchase': minor
---

Add `plans` / `billingPeriods` to `StripeConfig.create` and `StripeConfig.comparePlans` (upgrade, downgrade, or a longer or shorter period of the same plan), and `createPlanChange`: preview, apply and cancel a Stripe subscription's switch to another subscription product, with Apple's timing by default (an upgrade now, anything else at the period end), 3DS through a pending update, card declines as `PlanChangeError` with `mapDecline`'s reason, and period-end changes as a two-phase subscription schedule.
