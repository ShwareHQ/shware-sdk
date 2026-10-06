---
'@shware/analytics': minor
---

`classifyTouch` files SMS and push notifications as GA4 does, in the new `sms` and `mobile_push` channel groups (`sms` as the source or the medium; a medium ending in `push` or naming mobile or a notification, or `firebase` as the source) instead of `unassigned`, and ranks them with a referrer like email, so they never take an ad's credit. Reclassify stored sessions after upgrading.
