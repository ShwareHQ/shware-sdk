---
'@shware/security': minor
---

Send every OAuth redirect callback failure to `errorUri`: provider errors such as `access_denied` are forwarded with their `error_description` instead of being reported as an invalid query, and failures of the code exchange, user info, `onAuthorized` or session save redirect with the `OAuth2Error` type or `server_error` instead of escaping as a JSON error response.
