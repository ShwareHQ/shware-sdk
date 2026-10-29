---
'@shware/http': patch
---

`verifyStandardWebhook` refuses a `v1` signature that is missing or of another length as an invalid signature (`INVALID_ARGUMENT`), instead of failing with a `RangeError` from `timingSafeEqual` (a 500).
