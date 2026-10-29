---
'@shware/purchase': patch
---

The `CANCELED` and `EXPIRED` subscription statuses document what each platform maps to them: Stripe ends at CANCELED (including after `cancel_at_period_end`), Apple uses CANCELED only for `REVOKED` and EXPIRED for a natural end, and Google CANCELED means cancelled but not yet expired.
