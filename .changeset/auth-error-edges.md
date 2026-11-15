---
'@shware/security': patch
---

`oauth2State` and `oauth2Nonce` refuse a provider that is not configured with a 400 `invalid_request` instead of writing a key nobody can spend, and GitHub's `bad_verification_code` (an expired or reused code) is reported as `invalid_grant`, so the callback no longer shows it as `server_error`.
