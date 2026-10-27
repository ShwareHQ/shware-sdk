---
'@shware/security': minor
---

`AuthenticationError(reason, { metadata, message })` lets `onAuthorized` refuse a sign-in with a reason the client can act on; declare the reasons and their metadata shapes by augmenting `AuthenticationReasons`, and only those type-check (`AuthenticationReason` is their union). `Auth` answers it itself: the redirect flow lands on `errorUri` with `error=access_denied&reason=…` and the metadata entries as parameters (it was a bare `server_error`), the JSON routes (native, One Tap, email) answer 403 with a google.rpc `ErrorInfo` carrying the reason and metadata (the error used to reach the host's error handler).
