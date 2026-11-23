---
'@shware/purchase': minor
---

A Stripe subscription product can declare its free-trial days with `.product(id, plan, billingPeriod, { trialDays })`, read back with `getTrialDays(productId)` for Checkout's `subscription_data.trial_period_days`; who gets the trial stays the caller's decision.
