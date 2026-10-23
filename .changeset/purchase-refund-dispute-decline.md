---
'@shware/purchase': minor
---

Add the cross-platform `REFUND_STATUSES` / `RefundStatus` (with `REFUND_STATUS_TRANSITIONS`) and `DISPUTE_STATUSES` / `DisputeStatus` (with `CLOSED_DISPUTE_STATUSES`), `mapRefundStatus` / `mapDisputeStatus` for Stripe refunds and disputes, and `mapDecline`, which sorts a Stripe card failure into `DECLINE_REASONS` a cardholder can act on.
