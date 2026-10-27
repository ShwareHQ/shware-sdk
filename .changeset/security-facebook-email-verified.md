---
'@shware/security': minor
---

The Facebook provider no longer claims `email_verified: true`, which Facebook does not state; hosts should trust an address only when `email_verified === true`.
