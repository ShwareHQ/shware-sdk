---
'@shware/purchase': major
---

`PAST_DUE` is now in `AVAILABLE_STATUSES`: a Stripe subscription keeps granting access while Stripe retries a failed renewal (Smart Retries), the way an App Store or Play subscription does in `IN_GRACE_PERIOD`, instead of losing it the moment the first charge fails. Access still ends at `UNPAID` (Stripe gave up) and `ON_HOLD`. `ON_HOLD` is now documented for the App Store as well: a billing retry without a grace period, where the customer is not served, belongs there, so hosts whose Apple mapper returns `PAST_DUE` for `BILLING_RETRY` must change it to `ON_HOLD` before upgrading, or those subscribers gain access for the whole retry period.
