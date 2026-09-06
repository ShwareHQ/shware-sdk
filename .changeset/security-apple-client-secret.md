---
'@shware/security': minor
---

Add `createAppleClientSecret({ teamId, keyId, privateKey })` to `@shware/security/oauth2/provider`: returns `clientId => secret`, which signs the ES256 client-secret JWT Sign in with Apple requires from the team's `.p8` key at runtime and caches it per client id until shortly before expiry, so an app's bundle id and its web Services ID can share one key and the secret no longer has to be minted by hand and stored as a static value.
