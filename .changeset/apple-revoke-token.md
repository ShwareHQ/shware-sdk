---
'@shware/security': minor
---

The `apple` provider implements `revokeToken`, posting to Sign in with Apple's `/auth/revoke` so a host can revoke a user's authorization when they delete their account (App Store Review Guideline 5.1.1(v)). Apple's 200, which it also answers for a token that was already invalid, resolves; any other answer throws an `OAuth2Error` carrying Apple's `error` (`server_error` for a 5xx without one). `OAuth2Client.revokeToken` and the providers' `revokeToken` take an optional `tokenTypeHint` (`'refresh_token' | 'access_token'`, the new exported `TokenTypeHint` type), sent as `token_type_hint`; the generic RFC 7009 helper sends it too, so X's revoke accepts it. Sign-in is unchanged: both Apple paths already exchanged the authorization code and handed `token.refresh_token` and `clientId` to `onAuthorized`; the README now says to store them for the revoke.
