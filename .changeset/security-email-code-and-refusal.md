---
'@shware/security': minor
---

`auth.verifyEmailCode(email, code)` checks a mailed verification code without signing in and spends it, for hosts that verify or change a signed-in user's address (same storage and attempt limits as `loginEmail`, which now uses it). On the OAuth2 redirect flow a refusal thrown by `onAuthorized` (an error with a `reason` and optional string `metadata`, or a google.rpc `ErrorInfo` body such as `@shware/http`'s `StatusError`) now lands on `errorUri` as `error=access_denied&reason=…` with the metadata entries as parameters (`refusalOf` exported), instead of a bare `server_error`. Facebook and X no longer set `email_verified` (Facebook never states it; X's flag was the blue check), so hosts can trust `email_verified === true` from any provider.
