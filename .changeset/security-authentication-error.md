---
'@shware/security': minor
---

`onAuthorized` refuses a sign-in by throwing `AuthenticationError(reason, metadata)`: the JSON login routes answer `403` with a google.rpc `ErrorInfo` carrying both, and the redirect flow lands on `errorUri?error=access_denied&reason=…` with the metadata entries as parameters, instead of a bare `server_error`.
