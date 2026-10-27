---
'@shware/security': minor
---

`auth.verifyEmailCode(email, code)` checks a mailed verification code without signing in and spends it, with the same storage and attempt limits as `loginEmail` (which now calls it), for hosts that verify or change a signed-in user's address.
