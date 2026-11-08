---
'@shware/purchase': minor
---

Add `mapGraceUntil` to `@shware/purchase/app-store` and `@shware/purchase/google-play`: the ISO date a billing grace period ends (Apple's `gracePeriodExpiresDate`, Play's extended `expiryTime`), the date by which the customer has to fix their payment method, and null outside `IN_GRACE_PERIOD`. The `IN_GRACE_PERIOD` and `PAST_DUE` docs now say where that date comes from, and that a Stripe `PAST_DUE` subscription carries none.
