---
'@shware/purchase': major
---

`defineStripeConfig` takes `cancellationCoupons`, a retention coupon per billing interval (`{ month, year, … }`), in place of the single `cancellationCouponId`: a coupon that repeats for a few months discounts a monthly subscription's next invoices but never reaches a yearly one's renewal, so each interval names a coupon shaped for it, or none to make no offer. `StripeConfig.cancellationCouponFor(interval)` returns the coupon for a price's `recurring.interval`, or undefined.
