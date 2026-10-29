---
'@shware/security': patch
---

`verifyIdToken` keeps one remote key set per JWKS endpoint for the life of the process, so jose's key cache applies and the keys are no longer fetched for every id token.
