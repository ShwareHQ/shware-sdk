---
'@shware/security': minor
---

The X provider requests `confirmed_email` with the `users.email` scope (both in the defaults) and actually sends its `user.fields`, so `claims.email` is the address X confirmed and `email_verified` is `true` only then; the old flag was the account's blue check.
