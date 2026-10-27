---
'@shware/security': minor
---

`auth.verifyEmailCode(email, code)` spends a mailed verification code without signing in, for hosts that verify or change a signed-in user's address; same storage and attempt limits as `loginEmail`, which now uses it. A wrong code throws the `AuthenticationError` `loginEmail` answers with.
