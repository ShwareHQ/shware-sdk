---
'@shware/security': patch
---

Treat WeChat HTTP 200 `{ errcode, errmsg }` bodies on the token, refresh and user info endpoints as `OAuth2Error`s mapped to standard OAuth2 error codes, instead of returning them as tokens or user info.
