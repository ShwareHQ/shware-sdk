# @shware/security

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
