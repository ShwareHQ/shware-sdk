---
'@shware/security': major
---

OAuth2 config is keyed by identity provider instead of registration, each provider holding its web and native clients, and every id token is now checked for audience and issuer.

**Security fix.** Id tokens (Apple, Google, Facebook Limited Login) were verified for their signature only, so a token another app obtained from the same identity provider was accepted — through One Tap and the native login that meant signing in as that token's user. Tokens must now carry the client they were issued to as `aud` (the client the code was exchanged as, the client the native login resolved, or the web client for One Tap) and the provider's `iss`: `https://appleid.apple.com`; `https://accounts.google.com` or `accounts.google.com`; `https://www.facebook.com`. Facebook's native `access_token` login now sends an `appsecret_proof`, so it needs the client's secret and refuses tokens of other apps.

**Migration**

1. Replace `oauth2.client.provider` and `oauth2.client.registration` with `providers`, one key per identity source; registrations of one provider for different surfaces become clients of one entry. `clientSecret` may be a function of the client id, so `createAppleClientSecret(...)` is passed as is; omit it for public clients (Google's installed-app clients). `providers` may still be an async function. `clientAuthenticationMethod`, `authorizationGrantType` and `clientName` are gone (they were unused).

   ```ts
   // before
   provider: { apple, google },
   registration: async () => ({
     apple: { clientId: BUNDLE_ID, clientSecret: await appleSecret(BUNDLE_ID) },
     appleWeb: { provider: 'apple', clientId: SERVICES_ID, clientSecret: await appleSecret(SERVICES_ID) },
     google: { clientId: GOOGLE_WEB, clientSecret: GOOGLE_SECRET },
   }),
   // after
   providers: {
     apple: {
       provider: apple,
       web: { clientId: SERVICES_ID, clientSecret: appleSecret },
       native: [{ clientId: BUNDLE_ID, clientSecret: appleSecret }],
     },
     google: {
       provider: google,
       web: { clientId: GOOGLE_WEB, clientSecret: GOOGLE_SECRET },
       native: [{ clientId: GOOGLE_IOS }, { clientId: GOOGLE_ANDROID }],
     },
   },
   ```

   `redirectUri` and `scope` move onto the `web` client (`redirectUri` may also be set on a native client). Keys that pointed at the same implementation for separate user bases (two Google Cloud projects) stay separate keys, each with its own `provider: google`.

2. Client selection: the redirect flow and One Tap use `web`. The native login uses the app's `client_id`, which must be one of the provider's configured clients (`web` included), else `400 invalid_client`; without `client_id` it uses the only `native` client, or `web` when there is none, and refuses with `400 invalid_request` when several `native` clients are configured. This replaces Google's project-number check with membership in the configured list. Apps with several native clients of one provider must send `client_id`.

3. `onAuthorized` receives `{ provider, clientId, userInfo, token, attributes }` instead of `{ registrationId, ... }`: `provider` is the config key (`EMAIL` for email sign-in) and, with `claims.sub`, identifies the user across surfaces; `clientId` is the client used, absent for email sign-in. Hosts mapping `apple` / `appleWeb` back to one provider can drop that mapping.

4. Routes: `PATH` parameters are renamed from `:registrationId` to `:provider` (`/oauth2/state|nonce|authorization/:provider`, `/login/oauth2/code/:provider`, `/login/oauth2/native/:provider`). The URLs keep their shape, but the segment is now the provider key, so apps calling `/login/oauth2/native/appleApp` must call `/login/oauth2/native/apple`, and the provider's callback URL is `${baseUri}/login/oauth2/code/<provider key>` (update the redirect URI registered with the identity provider if the key changed). The third argument of `loginOAuth2Onetap` is the provider key (default `google`).

5. The success redirect carries `?status=success&provider=<key>` instead of `registrationId=<id>`.

6. `OAuth2Client` methods take `provider` instead of `registrationId`; `exchangeAuthorizationCode` and `loginOAuth2Native` also return the `clientId` used, `getUserInfo` requires it, and `refreshAccessToken` / `revokeToken` take `{ provider, clientId, ... }`. Custom `Provider` implementations receive `getUserInfo(token, { clientId, response })`, `getTokenInfo(idToken, clientId)`, an optional `clientSecret`, and `verifyIdToken(idToken, { jwkSetUri, issuer, audience })`.

Redirect flows started before the upgrade and finished after it fail once with `redirect provider mismatch`; nonces issued under a registration id are honoured only when that id equals the new provider key.
