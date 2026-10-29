# @shware/http

## 4.0.3

### Patch Changes

- 578e6a5: `authorizer` matches a `HEAD` request against the `GET` rules: Hono serves `HEAD` with the `GET` handler, so a rule like `{ path, methods: ['GET'] }` let `HEAD` through unauthenticated.
- 578e6a5: `verifyStandardWebhook` refuses a `v1` signature that is missing or of another length as an invalid signature (`INVALID_ARGUMENT`), instead of failing with a `RangeError` from `timingSafeEqual` (a 500).

## 4.0.2

### Patch Changes

- ac5cb31: Update dependencies to their latest versions within the declared ranges (react 19.3.1, @tanstack/* , posthog-js, jose, stripe, discord-api-types and the rest); `tsdown` stays pinned at 0.23.1 because 0.23.2 pulls a dts plugin that refuses TypeScript 7 without `isolatedDeclarations`.
- Updated dependencies [ac5cb31]
  - @shware/utils@2.0.1

## 4.0.1

### Patch Changes

- Updated dependencies [214e552]
  - @shware/utils@2.0.0

## 4.0.0

### Major Changes

- fa36a93: Google One Tap `prompt()` now reports why no credential was returned as flat, narrowable results: `{ authorized: false, skipped: true, reason?: SkippedReason }` (the reason is often absent under FedCM) and `{ authorized: false, dismissed: true, reason: DismissedReason }` (`cancel_called` | `flow_restarted`), next to the unchanged `unsupported` result. Breaking: `result.moment` and the `PromptMoment` type are removed. Callers that read `result.moment` should narrow with `'skipped' in result` / `'dismissed' in result` and read `result.reason`; callers that only read `authorized` / `credential` need no change.

## 3.6.0

### Minor Changes

- a9ed686: Move `zod` from `dependencies` to `peerDependencies` (`^4.6.5`). These packages export zod schemas and accept your own schemas (`zValidator`, `valid`, workflow props), so they must share the app's zod instance instead of bundling a second copy. Install `zod` alongside the package if your app does not already depend on it; pnpm and npm install it automatically as a peer.

### Patch Changes

- a9ed686: Upgrade dependencies to their latest versions.
- a9ed686: Stop installing `vitest` for consumers (it was listed under `dependencies` but only the tests use it) and drop the unused optional `react` peer.
- Updated dependencies [a9ed686]
  - @shware/utils@1.6.3

## 3.5.0

### Minor Changes

- c0b5cd6: Add `zBeaconJson(schema)`, a `json` validator that also accepts a `text/plain` body and parses it as JSON. `navigator.sendBeacon` has to send `text/plain` to stay a CORS simple request: as `application/json` a cross-origin beacon needs a preflight that a closing page often cannot complete, so the beacon is dropped. Hono's `json` target reads any non-JSON content type as `{}`, which `zValidator` then rejects. Malformed text is an `INVALID_ARGUMENT`, and schema violations are reported exactly as `zValidator` reports them. Use it only on routes that receive beacons and take no credentials.

## 3.4.1

### Patch Changes

- 0d439e3: Upgrade dependencies and peer dependencies to their latest versions.
- Updated dependencies [0d439e3]
  - @shware/utils@1.6.2

## 3.4.0

### Minor Changes

- 17d8b4b: Add `isErrorReason(data, ...reasons)` to check whether an error body carries `ErrorInfo` with one of the given reasons, so components can claim specific errors (inline field errors) and a global handler can skip them.

## 3.3.0

### Minor Changes

- dc7ae95: Add `isErrorReason(data, ...reasons)` to check whether an error body carries `ErrorInfo` with one of the given reasons, so components can claim specific errors (inline field errors) and a global handler can skip them.

## 3.2.1

### Patch Changes

- Dependency upgrades: `vitest` 4.1.11, and the `hono` 4.13.5 and `i18next` 26.4.0 peer floors. Same majors throughout.
- Updated dependencies
  - @shware/utils@1.6.1

## 3.2.0

### Minor Changes

- b72741b: Align `forwardToGoogleTagGateway` with the official Google Tag Gateway reference architectures, and export `getGeolocation`.

  - Pass gateway redirects (e.g. the 302 from `g/measurement/conversion`) through to the browser instead of following them server-side, so the browser makes the hop with its own google.com cookies (Google Signals / cross-domain conversion linking). This also restores streaming of the request body — no more buffering workaround.
  - Forward `user-agent`, `sec-ch-*` client hints, `accept-language` and `referer` so GA does not classify hits as bot traffic.
  - Forward the visitor IP via `x-forwarded-for`, falling back to the platform-specific client-IP header.
  - Send city-level geolocation via `x-forwarded-geolocation` (`latlong=<lat>,<lng>;city=<city>`).
  - Opt out of Next.js fetch caching with `cache: 'no-store'`.
  - Export `getGeolocation` from the package entry point.

## 3.1.1

### Patch Changes

- `hono` peer range moves to `^4.12.33`. No source change.

## 3.1.0

### Minor Changes

- 1b2df79: `errorHandler` classifies hono's `HTTPException` and client disconnects instead of reporting both as unknown 500s.

  - An `HTTPException` (malformed JSON body, `bearerAuth` rejection, …) maps its HTTP status onto the canonical `Code`, so callers get the standard error body with the real status instead of a 500. One that carries its own `res` is returned untouched, preserving headers such as `WWW-Authenticate`.
  - A request the client abandoned mid-flight — tab closed, navigation, aborted fetch — answers 499 `CANCELLED` and logs a single line. A body truncated by a disconnect is not a server fault, and the response is discarded anyway.
  - Status errors are recognized by shape as well as by `instanceof`, so a duplicated copy of the package or a custom `Status.adapter` no longer degrades every business error to "Unknown error".
  - Expected 4xx logs at `warn` and only 5xx at `error`; error bodies log on one line rather than pretty-printed across many, and the axios and unknown branches carry the request id.

## 3.0.1

### Patch Changes

- Type-aware lint fixes. Error-body parsing (`getErrorMessage`, `getErrorInfo`, `getFieldViolations`) now types wire bodies honestly and no longer throws on malformed payloads like `{ error: null }`; Google One Tap fails gracefully instead of throwing when the GSI script did not load.

## 3.0.0

### Major Changes

- Replace TypeScript enums with erasable const objects.

  BREAKING CHANGES:

  - `DetailType` and `PurchaseError` are const objects with derived union types; value dot access (`DetailType.ERROR_INFO`) is unchanged, but member-as-type positions must switch to `typeof DetailType.ERROR_INFO`, and `z.nativeEnum(...)`-style consumers should move to the derived union

## 2.12.0

### Minor Changes

- update deps, ts 7, tsdown

### Patch Changes

- Updated dependencies
  - @shware/utils@1.5.0

## 2.11.4

### Patch Changes

- update deps, fix oxlint, add page_referrer
- Updated dependencies
  - @shware/utils@1.4.5

## 2.11.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.4

## 2.11.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.3

## 2.11.1

### Patch Changes

- update onetap props

## 2.11.0

### Minor Changes

- update google one tap error handling

## 2.10.5

### Patch Changes

- try to fix redirect

## 2.10.4

### Patch Changes

- add nonce support

## 2.10.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.1

## 2.10.2

### Patch Changes

- remove net deps

## 2.10.1

### Patch Changes

- remove getGeolocation export

## 2.10.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.3.0

## 2.9.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.2.1

## 2.9.2

### Patch Changes

- forwardToGoogleTagGateway

## 2.9.1

### Patch Changes

- update deps

## 2.9.0

### Minor Changes

- update google one tap prompt

## 2.8.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.2.0

## 2.7.1

### Patch Changes

- stringify error

## 2.7.0

### Minor Changes

- getErrorReason -> getErrorInfo

## 2.6.1

### Patch Changes

- remove reason types

## 2.6.0

### Minor Changes

- declaration merging for ErrorReason

## 2.5.1

### Patch Changes

- add rate-limiter

## 2.5.0

### Minor Changes

- rename to Pages, Items

## 2.4.4

### Patch Changes

- add items util

## 2.4.3

### Patch Changes

- add pages util

## 2.4.2

### Patch Changes

- update initialPageParam

## 2.4.1

### Patch Changes

- feat support undefined response for cursor.of

## 2.4.0

### Minor Changes

- feat support undefined cursor

## 2.3.0

### Minor Changes

- fix append script more than once

## 2.2.5

### Patch Changes

- update deps

## 2.2.4

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint
- Updated dependencies
  - @shware/utils@1.1.4

## 2.2.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.3

## 2.2.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.1

## 2.2.1

### Patch Changes

- fix package error

## 2.2.0

### Minor Changes

- use @shware/utils

## 2.1.0

### Minor Changes

- remove null value

## 2.0.1

### Patch Changes

- update deps

## 2.0.0

### Major Changes

- update error types and add more error details

## 1.2.13

### Patch Changes

- update deps

## 1.2.12

### Patch Changes

- update deps

## 1.2.11

### Patch Changes

- fix zero, empty string, false cache value

## 1.2.10

### Patch Changes

- remove axios dependency

## 1.2.9

### Patch Changes

- global -> globalThis

## 1.2.8

### Patch Changes

- add fetch utils

## 1.2.7

### Patch Changes

- update deps

## 1.2.6

### Patch Changes

- update deps

## 1.2.5

### Patch Changes

- add base62 support

## 1.2.4

### Patch Changes

- update deps

## 1.2.3

### Patch Changes

- add origin and sec-fetch-site header support

## 1.2.2

### Patch Changes

- chore: eslint

## 1.2.1

### Patch Changes

- fix build

## 1.2.0

### Minor Changes

- support string config

## 1.1.13

### Patch Changes

- update deps

## 1.1.12

### Patch Changes

- add once util

## 1.1.11

### Patch Changes

- add authorizer function

## 1.1.10

### Patch Changes

- add csrf middleware

## 1.1.9

### Patch Changes

- update deps
