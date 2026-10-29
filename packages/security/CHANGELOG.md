# @shware/security

## 8.0.1

### Patch Changes

- 578e6a5: The GitHub provider sets `sub` to the account id as a string (`String(id)`); GitHub answers it as a number, which reached hosts typed as a string claim.
- 578e6a5: `verifyIdToken` keeps one remote key set per JWKS endpoint for the life of the process, so jose's key cache applies and the keys are no longer fetched for every id token.
- 578e6a5: The redirect flow's PKCE `code_verifier` is 32 random bytes in base64url (43 characters, the RFC 7636 minimum) instead of a 36-character UUID, which strict providers could refuse.
- 578e6a5: `oauth2Authorization` gives the session it creates for a browser without one a 10-minute inactive interval (the life of the OAuth2 state), so abandoned flows no longer keep a row and cookie for the default interval. A session the browser already carries keeps its interval, and sign-in still moves to a new session with the default.
- 578e6a5: A failed token revocation logs `Revoke token error` instead of the misleading `Refresh token error`.

## 8.0.0

### Major Changes

- 594d32c: The JSON login routes (native, One Tap, email, desktop) now answer every failure they know with one google.rpc error body, so a client branches on `ErrorInfo.reason` everywhere and the host's error handler only sees server faults. What changed on the wire: a wrong or exhausted email code is `403 PERMISSION_DENIED` (was 400); a missing or replayed One Tap / native nonce is `403 NONCE_MISSING` / `NONCE_MISMATCH` (was a raw `{ error: 'invalid_request', error_description }` with 401 or 400); a bad `code_verifier`, `attributes`, content type or non-JSON body is `400 INVALID_ARGUMENT` with a reason (`INVALID_CODE_VERIFIER`, `INVALID_ATTRIBUTES`, `INVALID_CONTENT_TYPE`, `INVALID_JSON`) instead of a raw OAuth2-style body or a 500; an `OAuth2Error` from the provider client is answered by what it means (`400` for a malformed request, `403` for a refused code or token, `503` for a provider outage) with `OAUTH2_<error>` as the reason instead of propagating to the host; `EMAIL_DELIVERY_FAILED` is `503 UNAVAILABLE` (was 400); a desktop code with the wrong verifier is `403 INVALID_DESKTOP_CODE` (was 400). An id token that fails verification is now an `invalid_grant` `OAuth2Error` (was `invalid_request`), so the redirect flow reports it as such. Removed: the never-implemented `loginPhone`, `sendPhoneVerificationCode`, `PATH.LOGIN_PHONE` and `PATH.SEND_PHONE_VERIFICATION_CODE`; the `EmailCodeVerification` type. `AuthService` now declares `desktopAuthorize` and `desktopExchange`. `oauth2Authorization` answers an unknown provider as `400 OAUTH2_INVALID_REQUEST` instead of throwing. `errorResponse(error)` is exported for the host's error handler, so a flow that calls `Auth` directly answers its errors the same way. The session id is no longer read from `Authorization: Bearer`. For a client without a cookie jar, `session: { header: true }` (off by default) carries it in `X-Auth-Token` both ways, as Spring Session does, leaving `Authorization` to a future API-token credential. The session attribute that names the signed-in principal is now `principalName` (`PRINCIPAL_NAME_INDEX_NAME`), not Spring Session's `org.springframework.session.FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME`, and the Spring `SPRING_SECURITY_CONTEXT` fallback is gone: sessions stored before this release no longer resolve to a principal, so users sign in again (or migrate the attribute key); the Redis repository's default namespace is `app:session`.

### Minor Changes

- 8952eeb: `AuthenticationError(reason, { metadata, message })` lets `onAuthorized` refuse a sign-in with a reason the client can act on. The built-in reasons (`ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `EMAIL_ALREADY_USED`, `EMAIL_NOT_VERIFIED`, `SIGNUP_DISABLED`, plus the ones the SDK throws itself, all listed in `AUTHENTICATION_REASONS`) cover the usual account states; hosts add their own with their metadata shapes by augmenting `AuthenticationReasons`, and only those type-check (`AuthenticationReason` is the union). `Auth` answers it itself: the redirect flow lands on `errorUri` with `error=access_denied&reason=…` and the metadata entries as parameters (it was a bare `server_error`), the JSON routes answer `403 PERMISSION_DENIED` with a google.rpc `ErrorInfo` carrying the reason and metadata (the error used to reach the host's error handler).
- 8952eeb: The Facebook provider no longer sets `email_verified`: the Graph API does not state it, so the flag was a hardcoded `true`. Hosts can now trust `email_verified === true` from any provider.
- 8952eeb: `auth.verifyEmailCode(email, code)` spends a mailed verification code without signing in, for hosts that verify or change a signed-in user's address; same storage and attempt limits as `loginEmail`, which now uses it. A wrong code throws the `AuthenticationError` `loginEmail` answers with.
- 8952eeb: The X provider requests `confirmed_email` with the `users.email` scope (both in the defaults) and actually sends its `user.fields` (the built URL was never used), so `claims.email` is the address X confirmed and `email_verified` is `true` only then; the old flag was the blue check.

## 7.1.1

### Patch Changes

- ac5cb31: Update dependencies to their latest versions within the declared ranges (react 19.3.1, @tanstack/* , posthog-js, jose, stripe, discord-api-types and the rest); `tsdown` stays pinned at 0.23.1 because 0.23.2 pulls a dts plugin that refuses TypeScript 7 without `isolatedDeclarations`.
- Updated dependencies [ac5cb31]
  - @shware/utils@2.0.1

## 7.1.0

### Minor Changes

- 2232418: `getPrincipal` and `isAuthenticated` now renew the session they authenticate (sliding expiration), so a user who keeps using the app is no longer signed out after `maxInactiveInterval` unless they also call `logged`. No extra read: the loaded session's `lastAccessedTime` is compared in memory, and writes are spaced by the new `AuthConfig.session.touchInterval` (seconds, default 3600), so an active session costs one write per interval.

## 7.0.0

### Major Changes

- 22ba466: `loginOAuth2Onetap` now requires the One Tap `credential` to carry a single-use nonce issued by `GET /oauth2/nonce/google` (`oauth2Nonce`), consuming it on sign-in so a leaked ID token cannot be replayed for new sessions; a missing, unknown or reused nonce is answered `401 invalid_request`. Migration: before calling `prompt`, the web app fetches `GET /oauth2/nonce/google` and passes `nonce` to `prompt({ client_id, nonce })` (`@shware/http/google-one-tap`). Hosts that still serve a front end without it can set `oauth2: { onetap: { requireNonce: false } }` (default `true`) during the rollout; a nonce the credential carries is still checked. The commented-out `g_csrf_token` double-submit check, which FedCM mode cannot use, is removed.

## 6.3.1

### Patch Changes

- fd6f005: Sign an OAuth2 redirect login in on a new session id instead of the one the authorization started on, and delete the old session, so a planted session id never becomes authenticated (session fixation).

## 6.3.0

### Minor Changes

- b6c8ec5: `DBIndexedSessionRepository` passes `isNew` on the entity it hands `DBAdapter.save`: `true` for a session created in this request, `false` for one the adapter loaded. Adapters can insert or update on it (as Spring Session's JDBC repository does) instead of upserting, so a save racing a logout or kick cannot write a deleted session back. Entities the adapter returns need not carry it.

## 6.2.2

### Patch Changes

- f25cbbb: `logout` now clears the session cookie with the same `domain`, `path`, `sameSite` and `secure` attributes it was set with, so cookies set with a `Domain` are actually removed.

## 6.2.1

### Patch Changes

- Updated dependencies [214e552]
  - @shware/utils@2.0.0

## 6.2.0

### Minor Changes

- 64a630b: Accept an optional PKCE `code_verifier` in the native OAuth2 login body (`NativeCredential.code_verifier`) and send it with the provider's code exchange (Google); a malformed verifier is a 400, and logins without one behave as before. `LoginOAuth2NativeParams.pkce` now carries only `code_verifier`.

## 6.1.2

### Patch Changes

- 1543c2c: Treat WeChat HTTP 200 `{ errcode, errmsg }` bodies on the token, refresh and user info endpoints as `OAuth2Error`s mapped to standard OAuth2 error codes, instead of returning them as tokens or user info.

## 6.1.1

### Patch Changes

- b516ffb: An `OAuth2Error` thrown during the OAuth callback is now logged and reported on `errorUri` by code only (`invalid_grant`, `access_denied` or `temporarily_unavailable` as is, anything else as `server_error`), so its message no longer leaks a client id or a provider response into the URL.

## 6.1.0

### Minor Changes

- cf7140c: Send every OAuth redirect callback failure to `errorUri`: provider errors such as `access_denied` are forwarded with their `error_description` instead of being reported as an invalid query, and failures of the code exchange, user info, `onAuthorized` or session save redirect with the `OAuth2Error` type or `server_error` instead of escaping as a JSON error response.

## 6.0.0

### Major Changes

- 04fc104: Email sign-in now trims and lowercases the email address before validating it, so every casing of an address shares one verification code, attempt budget and resend cooldown, and `loginEmail` presents the lowercased address as `claims.sub` and `claims.email`.

  **Migration**

  Existing `EMAIL` identities stored with a mixed-case subject must be lowercased before deploying (merging any accounts whose subjects differ only in case), otherwise those users get a new account on their next sign-in because `sub` now arrives in lowercase.

- e6490b5: Cap guesses per email verification code and throttle resends.

  **Security fix.** `loginEmail` compared the six-digit code without counting attempts, so the code could be brute-forced within its 10-minute lifetime. Each login attempt is now counted atomically before the comparison; after `maxAttempts` (default 5) the code is discarded and `loginEmail` answers `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`. `sendEmailVerificationCode` allows one send per email per `resendCooldown` seconds (default 60) and answers `429 VERIFICATION_CODE_RESEND_TOO_SOON` otherwise; a failed delivery releases the cooldown, and a new code resets the attempt budget. Both limits are set through the new `verificationCode: { maxAttempts, resendCooldown }` option of `Auth`.

  **Migration**

  `KVRepository` has a new required method, `increment(key, expiresIn): Promise<number>`. `RedisKVRepository` implements it; custom implementations must add it. It must be atomic: an absent or expired key is created with value 1 expiring in `expiresIn` seconds, an existing key is incremented and keeps its expiry, and the new count is returned. On Postgres, with `kv(key text primary key, value text, expires_at timestamptz)`:

  ```sql
  insert into kv (key, value, expires_at) values ($1, '1', now() + make_interval(secs => $2))
  on conflict (key) do update set
    value = case when kv.expires_at <= now() then '1' else (kv.value::int + 1)::text end,
    expires_at = case when kv.expires_at <= now() then excluded.expires_at else kv.expires_at end
  returning value::int;
  ```

  Clients may want to handle the two new error reasons: ask for a new code on `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`, and wait before resending on `VERIFICATION_CODE_RESEND_TOO_SOON`.

## 5.0.1

### Patch Changes

- 98039fd: Send a `User-Agent` on every GitHub request (Cloudflare Workers' fetch sends none, so GitHub's API answered 403), reject the HTTP 200 error bodies GitHub's token endpoint returns for failed exchanges, and include GitHub's status and response body in user-info errors.

## 5.0.0

### Major Changes

- 7a79e4f: OAuth2 config is keyed by identity provider instead of registration, each provider holding its web and native clients, and every id token is now checked for audience and issuer.

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

## 4.1.0

### Minor Changes

- cd49b8b: Sign in with Apple now keeps the user's name, which Apple sends only on the first authorization and never in the id token: the web callback reads the form_post `user` field and the native login body accepts an optional `fullName`, the platform's `PersonNameComponents` passed through as is (iOS `ASAuthorizationAppleIDCredential.fullName`, expo-apple-authentication's `credential.fullName`), whose parts are mapped to the standard `given_name` / `family_name` / `middle_name` / `nickname` claims with `name` composed by the new exported `composeName` helper (CJK family name first without a space, otherwise given name first); the cleaned raw payloads land in `userInfo.data.user` (web) and `userInfo.data.fullName` (native, the only place `namePrefix` / `nameSuffix` are kept), and since the name is unsigned client input each part is trimmed and capped at 64 characters while anything malformed is ignored rather than failing the login. `Provider.getUserInfo` takes an optional second `AuthorizationResponse` argument, and the Apple provider no longer reads the `name` / `picture` / `user` id-token fields that Apple never sends.

## 4.0.0

### Major Changes

- ea0aed7: `AuthorizedHandler` now takes the request and one `Authorization` object instead of positional arguments: `(request, { registrationId, userInfo, token?, attributes })`. Migrate `onAuthorized(request, registrationId, userInfo, token)` to `onAuthorized(request, { registrationId, userInfo, token })`. `Authorization`, `AuthorizedHandler` and `OAuth2AuthorizationOptions` are exported.

  New authorization attributes for the OAuth2 redirect flow: `oauth2Authorization(request, { attributes })` stores string values with the authorization request in the session (never sent to the provider), and `loginOAuth2Code` hands them to the handler as `authorization.attributes` once session, state and registration check out; they are removed with the request after a successful login and capped at 2 KB. Native, One Tap (JSON) and email logins accept the same `attributes` as an optional field of their request body (string values, at most 2 KB, `400` otherwise) and pass `{}` without it; native strips it from the credentials sent to the provider.

  Also fixes the `form_post` callback detection to accept a `charset` parameter on `application/x-www-form-urlencoded`.

## 3.4.1

### Patch Changes

- f3114ee: Normalize Tailwind utility ordering and documentation formatting with the repository formatter.
- f3114ee: Align test mocks and fixtures with their real SDK contracts, exercise TanStack middleware through its actual builder, and remove unused test imports. No runtime behavior or API dependencies change.

## 3.4.0

### Minor Changes

- a9ed686: Move `zod` from `dependencies` to `peerDependencies` (`^4.6.5`). These packages export zod schemas and accept your own schemas (`zValidator`, `valid`, workflow props), so they must share the app's zod instance instead of bundling a second copy. Install `zod` alongside the package if your app does not already depend on it; pnpm and npm install it automatically as a peer.

### Patch Changes

- a9ed686: Upgrade dependencies to their latest versions.
- a9ed686: Make `ioredis` an optional peer instead of a dependency: the Redis session store only takes the `Redis` client you pass in as a type, so apps that do not use it no longer install ioredis. Drop the unused `uuid` dependency.
- Updated dependencies [a9ed686]
  - @shware/utils@1.6.3

## 3.3.2

### Patch Changes

- 0d439e3: Upgrade dependencies and peer dependencies to their latest versions.
- Updated dependencies [0d439e3]
  - @shware/utils@1.6.2

## 3.3.1

### Patch Changes

- 4bd2b49: Export `OAuth2Error` (and `OAuth2ErrorType`) from the package root, so an api can recognise a provider's refusal in its error handler and answer 4xx instead of 500.

## 3.3.0

### Minor Changes

- 359dac9: Google `loginOAuth2Native` exchanges the code for the client the app names (`client_id` / `redirect_uri` in the credentials, i.e. the iOS or Android client and its custom-scheme redirect) instead of the registration's web client, which Google refused because the code was issued to another client. No secret is sent for those installed-app clients, and a client from another Google Cloud project (different project-number prefix) is rejected with `invalid_client`. Without a `client_id` in the credentials the registration's client and secret are used as before. `exchangeAuthorizationCode` omits `client_secret` when it is empty.

## 3.2.0

### Minor Changes

- 5a928cc: Add `createAppleClientSecret({ teamId, keyId, privateKey })` to `@shware/security/oauth2/provider`: returns `clientId => secret`, which signs the ES256 client-secret JWT Sign in with Apple requires from the team's `.p8` key at runtime and caches it per client id until shortly before expiry, so an app's bundle id and its web Services ID can share one key and the secret no longer has to be minted by hand and stored as a static value.

## 3.1.1

### Patch Changes

- Dependency upgrades: `jose` 6.2.10 and `uuid` 14.0.2.
- Updated dependencies
  - @shware/utils@1.6.1

## 3.1.0

### Minor Changes

- `ioredis` moves to `^6.0.0`.

  - The session and KV repositories take a `Redis` instance from the caller, so a consumer still on ioredis 5 has to upgrade with this release for the instance to type-check.
  - v6 requires Node.js 20+ and opens connections with a `HELLO 3` handshake, falling back to RESP2 when the server rejects it — Redis 6+ on the server side, or `protocol: 2` to keep the v5 handshake. Reply mapping defaults to `legacy`, so `hgetall`, `zrevrangebyscore` and `smembers` return the same shapes the repositories already parse; the full crud, attribute and session-id-rotation suite passes against a live Redis.
  - `jose` moves to `^6.2.7`.

## 3.0.1

### Patch Changes

- Type-aware lint fixes. `Session.setAttribute` now accepts `null` type-visibly (removes the attribute, as before); reading a session whose stored context JSON parses to `null` no longer throws.

## 3.0.0

### Major Changes

- Replace TypeScript enums with erasable const declarations.

  BREAKING CHANGES:

  - `Provider` is now a type-only union derived from the new `PROVIDERS` array; dot access like `Provider.APPLE` becomes the string literal `'APPLE'`
  - `ALL_PROVIDERS` is removed — use `PROVIDERS`
  - `OidcScopes` type is renamed to `OidcScope` (a value of the type is a single scope); the new `OIDC_SCOPES` array is exported as a value for the first time

## 2.6.0

### Minor Changes

- update deps, ts 7, tsdown

### Patch Changes

- Updated dependencies
  - @shware/utils@1.5.0

## 2.5.3

### Patch Changes

- update deps, fix oxlint, add page_referrer
- Updated dependencies
  - @shware/utils@1.4.5

## 2.5.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.4

## 2.5.1

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.3

## 2.5.0

### Minor Changes

- Desktop sign-in: require PKCE (S256). `desktopAuthorize` now takes `{ code_challenge, code_challenge_method: 'S256' }` in the JSON body and pins the challenge to the auth code in KV; `desktopExchange` now requires a matching `code_verifier`. This blocks an attacker who captures only the auth code (browser history, malicious extension, loopback packet sniff) from minting a session.

  Breaking change for `desktopAuthorize` / `desktopExchange` callers: both endpoints' request bodies gained required fields. The KV record format also changed from raw `principalName` string to `{ name, cc }` JSON; in-flight codes from the previous version will fail with `INVALID_DESKTOP_CODE` after upgrade and need to be re-issued (5-min TTL bounds the impact).

## 2.4.1

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.1

## 2.4.0

### Minor Changes

- desktop auth

## 2.3.1

### Patch Changes

- update deps

## 2.3.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.3.0

## 2.2.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.2.1

## 2.2.1

### Patch Changes

- update deps

## 2.2.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.2.0

## 2.1.4

### Patch Changes

- add error log

## 2.1.3

### Patch Changes

- fix import

## 2.1.2

### Patch Changes

- add SEND_EMAIL_VERIFICATION_CODE, SEND_PHONE_VERIFICATION_CODE path

## 2.1.1

### Patch Changes

- add CLEANUP_EXPIRED_SESSIONS path

## 2.1.0

### Minor Changes

- login with email

## 2.0.3

### Patch Changes

- update deps

## 2.0.2

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint
- Updated dependencies
  - @shware/utils@1.1.4

## 2.0.1

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.3

## 2.0.0

### Major Changes

- add async config support

## 1.5.12

### Patch Changes

- update deps

## 1.5.11

### Patch Changes

- update deps

## 1.5.10

### Patch Changes

- update deps

## 1.5.9

### Patch Changes

- update deps

## 1.5.8

### Patch Changes

- add await

## 1.5.7

### Patch Changes

- update deps

## 1.5.6

### Patch Changes

- update deps

## 1.5.5

### Patch Changes

- update deps

## 1.5.4

### Patch Changes

- add types

## 1.5.3

### Patch Changes

- chore: eslint

## 1.5.2

### Patch Changes

- update deps

## 1.5.1

### Patch Changes

- update deps

## 1.5.0

### Minor Changes

- use jose, remove jsonwebtoken

## 1.4.9

### Patch Changes

- update deps
