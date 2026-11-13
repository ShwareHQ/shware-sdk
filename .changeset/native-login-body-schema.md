---
'@shware/security': patch
---

`loginOAuth2Native` validates the body it is posted: each `NativeCredential` field must be a string when present (`fullName` an object), a `400 INVALID_ARGUMENT` naming the field otherwise, and a provider missing the credential it needs — Apple's and Google's `code` — answers `400 OAUTH2_INVALID_REQUEST` instead of failing with a 500 from an assertion. A `code_verifier` that is not a string is now that same `INVALID_ARGUMENT`; one of the wrong format stays `INVALID_CODE_VERIFIER`.
