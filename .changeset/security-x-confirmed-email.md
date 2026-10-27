---
'@shware/security': minor
---

The X provider requests `confirmed_email` with the `users.email` scope (both in the defaults) and actually sends its `user.fields` (the built URL was never used), so `claims.email` is the address X confirmed and `email_verified` is `true` only then; the old flag was the blue check.
