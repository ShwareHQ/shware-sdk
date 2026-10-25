---
'@shware/security': minor
---

Accept an optional PKCE `code_verifier` in the native OAuth2 login body (`NativeCredential.code_verifier`) and send it with the provider's code exchange (Google); a malformed verifier is a 400, and logins without one behave as before. `LoginOAuth2NativeParams.pkce` now carries only `code_verifier`.
