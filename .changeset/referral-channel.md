---
'@shware/analytics': minor
---

`@shware/analytics/attribution`: `referral_program` joins `CHANNELS`, the channel of a product's own referral programme — a session that came through a member's link or code. How a product recognises one (a `/refer/<code>` path, a code entered at sign-up) differs too much between products to be a shared rule, so that stays with the product's `touchpoint`; the name is shared so dashboards agree. It is deliberately not `referral`, which is the channel group of any outside site.
