---
'@shware/security': patch
---

An `OAuth2Error` thrown during the OAuth callback is now logged and reported on `errorUri` by code only (`invalid_grant`, `access_denied` or `temporarily_unavailable` as is, anything else as `server_error`), so its message no longer leaks a client id or a provider response into the URL.
