---
'@shware/workflow': patch
---

A failed wake (`sendEvent` to a waiting instance) is logged with `console.warn`, naming the instance and the error, instead of being swallowed; the subscription is still kept for the next attempt.
