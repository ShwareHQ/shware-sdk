---
'@shware/security': minor
---

`AuthenticationError(reason, { metadata, message })` lets `onAuthorized` refuse a sign-in with a reason the client can act on. The built-in reasons (`ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `EMAIL_ALREADY_USED`, `EMAIL_NOT_VERIFIED`, `SIGNUP_DISABLED`, plus the ones the SDK throws itself, all listed in `AUTHENTICATION_REASONS`) cover the usual account states; hosts add their own with their metadata shapes by augmenting `AuthenticationReasons`, and only those type-check (`AuthenticationReason` is the union). `Auth` answers it itself: the redirect flow lands on `errorUri` with `error=access_denied&reason=…` and the metadata entries as parameters (it was a bare `server_error`), the JSON routes answer `403 PERMISSION_DENIED` with a google.rpc `ErrorInfo` carrying the reason and metadata (the error used to reach the host's error handler).
