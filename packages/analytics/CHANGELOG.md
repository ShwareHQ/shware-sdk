# @shware/analytics

## 4.1.0

### Minor Changes

- remove deprecated fields and schema

## 4.0.1

### Patch Changes

- fix: bundle bowser into dist (tsdown `noExternal`) to fix ESM/CJS interop. bowser's entry points (`main`/`browser`) resolve to the CJS-only `es5.js` with no `exports` map, so any environment that loads the package as raw ESM — e.g. Vite dev with the package excluded from `optimizeDeps` (TanStack Start does this transitively via `clickIdMiddleware`'s `@tanstack/react-start` import) — threw `SyntaxError: The requested module 'bowser/es5.js' does not provide an export named 'default'` and broke client hydration. The published dist no longer imports `bowser`, so consumers need no `optimizeDeps` workaround; `bowser` moved from dependencies to devDependencies. (Same fix as 3.8.3, ported to the 4.x line.)

## 4.0.0

### Major Changes

- Persist Meta `_fbc` and Reddit `_rdt_cid` click-id cookies server-side instead of on the client.

  **BREAKING:** the client-side `useClickIdPersistence` hook has been removed and the `Analytics` component no longer writes `_fbc`/`_rdt_cid` via `document.cookie`. To keep click-id persistence you must now set these cookies server-side — either register `clickIdMiddleware` on TanStack Start, or call `resolveClickIdCookies` in your framework's request handler. Apps that don't migrate will lose `_fbc`/`_rdt_cid` persistence.

  New server-side APIs:

  - `resolveClickIdCookies` (plus `parseFbc`, `formatFbc`, `toSetCookieHeaders`) from `@shware/analytics/server` — a framework-agnostic helper that sets `_fbc`/`_rdt_cid` on the document response following Meta's conditional-write rule: write on a new or changed `fbclid`, preserve the original `creationTime` otherwise, and clear values older than 90 days. This resolves the Events Manager "expired fbclid" warning and keeps the cookie alive for the full 90 days in Safari, where a JavaScript-set cookie on an fbclid-decorated landing page is capped to 24 hours.
  - `clickIdMiddleware` / `createClickIdMiddleware` from `@shware/analytics/tanstack` — a TanStack Start request middleware that wraps the helper and sets the cookies on the document response (with `Cache-Control: private, no-store`). `refresh` defaults to `true` as a best-effort ITP self-heal.

## 3.8.3

### Patch Changes

- fix: bundle bowser into dist (tsdown `noExternal`) to fix ESM/CJS interop; `bowser` moved from dependencies to devDependencies. See 4.0.1 for details.

## 3.8.2

### Patch Changes

- update visitor schema
- Updated dependencies
  - @shware/utils@1.5.1

## 3.8.1

### Patch Changes

- update properties field

## 3.8.0

### Minor Changes

- add visitor.tags

## 3.7.0

### Minor Changes

- update deps, ts 7, tsdown

### Patch Changes

- Updated dependencies
  - @shware/utils@1.5.0

## 3.6.4

### Patch Changes

- update deps, fix oxlint, add page_referrer
- Updated dependencies
  - @shware/utils@1.4.5

## 3.6.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.4

## 3.6.2

### Patch Changes

- refresh legacy system id to UUID v7

## 3.6.1

### Patch Changes

- ignore non ad events

## 3.6.0

### Minor Changes

- add openai pixel and conversions api

## 3.5.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.3

## 3.5.1

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.1

## 3.5.0

### Minor Changes

- cache fbclid

## 3.4.1

### Patch Changes

- fix xk country code for meta conversions api

## 3.4.0

### Minor Changes

- simplify useTrackImpression

## 3.3.0

### Minor Changes

- update deps
- update GA4 web-vitals properties

### Patch Changes

- Updated dependencies
  - @shware/utils@1.3.0

## 3.2.7

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.2.1

## 3.2.6

### Patch Changes

- add gaSrc props for gtag gateway

## 3.2.5

### Patch Changes

- remove localhost event

## 3.2.4

### Patch Changes

- currency case

## 3.2.3

### Patch Changes

- split posthog package

## 3.2.2

### Patch Changes

- update deps

## 3.2.1

### Patch Changes

- send posthog event

## 3.2.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.2.0

## 3.1.3

### Patch Changes

- fix visitorId edge case

## 3.1.2

### Patch Changes

- add useTrackImpression hook

## 3.1.1

### Patch Changes

- update deps

## 3.1.0

### Minor Changes

- add tanstack router support

## 3.0.9

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint
- Updated dependencies
  - @shware/utils@1.1.4

## 3.0.8

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.3

## 3.0.7

### Patch Changes

- add tests
- Updated dependencies
  - @shware/utils@1.1.2

## 3.0.6

### Patch Changes

- add storage keys

## 3.0.5

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.1

## 3.0.4

### Patch Changes

- remove logs

## 3.0.3

### Patch Changes

- remove passive true

## 3.0.2

### Patch Changes

- add log

## 3.0.1

### Patch Changes

- add trigger properties

## 3.0.0

### Major Changes

- remove expo-router deps

## 2.18.0

### Minor Changes

- simplify session analytics

## 2.17.3

### Patch Changes

- add outbound click analytics

## 2.17.2

### Patch Changes

- add first_open and first_visit event, define automatically collected events

## 2.17.1

### Patch Changes

- ignore google analytics auto events

## 2.17.0

### Minor Changes

- add utils deps & fix session duration time\

## 2.16.2

### Patch Changes

- Updated dependencies
  - @shware/utils@1.0.0

## 2.16.1

### Patch Changes

- update v1 schema

## 2.16.0

### Minor Changes

- fix type mismatch
- add platform and environment field for visitor and event object
- simplify types

## 2.15.5

### Patch Changes

- export Platform and Environment enum

## 2.15.4

### Patch Changes

- make environment and platform field required

## 2.15.3

### Patch Changes

- reset session when timeout

## 2.15.2

### Patch Changes

- session active time

## 2.15.1

### Patch Changes

- update session analytics

## 2.15.0

### Minor Changes

- add sessionId

## 2.14.4

### Patch Changes

- fix content-type

## 2.14.3

### Patch Changes

- fix import error

## 2.14.2

### Patch Changes

- fix import error

## 2.14.1

### Patch Changes

- update deps

## 2.14.0

### Minor Changes

- add session analytics
- simplify getTags function
- ignore server events
- add setup cache
- add sendBeacon function
- use sync storage

## 2.13.5

### Patch Changes

- add app_launch event

## 2.13.4

### Patch Changes

- update deps

## 2.13.3

### Patch Changes

- remove slash on endpoint url

## 2.13.2

### Patch Changes

- add reddit pixel cookie

## 2.13.1

### Patch Changes

- safari ITP: store fbc to cookie and localstorage

## 2.13.0

### Minor Changes

- remove axios dependency

## 2.12.4

### Patch Changes

- global -> globalThis

## 2.12.3

### Patch Changes

- add X-RestLi-Method: BATCH_CREATE header

## 2.12.2

### Patch Changes

- conversions api error handling & retry

## 2.12.1

### Patch Changes

- add fetch utils

## 2.12.0

### Minor Changes

- add distinct_id support and remove setUserId

## 2.11.6

### Patch Changes

- fix types

## 2.11.5

### Patch Changes

- support native fingerprint

## 2.11.4

### Patch Changes

- add share params

## 2.11.3

### Patch Changes

- ignore empty events

## 2.11.2

### Patch Changes

- fix server event mapping

## 2.11.1

### Patch Changes

- fix linkedin types

## 2.11.0

### Minor Changes

- add linkedin linktr definition

## 2.10.1

### Patch Changes

- support linkedin click ids

## 2.10.0

### Minor Changes

- support linkedin conversions api

## 2.9.0

### Minor Changes

- add linkedin insight tag support

## 2.8.6

### Patch Changes

- remove metrics from conversions api

## 2.8.5

### Patch Changes

- typo \_rtd_uuid -> \_rdt_uuid

## 2.8.4

### Patch Changes

- chore remove FID

## 2.8.3

### Patch Changes

- remove meta, reddit metrics

## 2.8.2

### Patch Changes

- remove third party web vitals report

## 2.8.1

### Patch Changes

- fix: remove undefined field

## 2.8.0

### Minor Changes

- support reddit ads, refactor event utils

## 2.7.0

### Minor Changes

- add setGAUser, update setVisitor params

## 2.6.2

### Patch Changes

- add survey support

## 2.6.1

### Patch Changes

- update deps

## 2.6.0

### Minor Changes

- update event name

## 2.5.2

### Patch Changes

- update deps

## 2.5.1

### Patch Changes

- fix import

## 2.5.0

### Minor Changes

- add previous page analytics

## 2.4.1

### Patch Changes

- update deps

## 2.4.0

### Minor Changes

- replace AsyncStorage with expo-sqlite

## 2.3.11

### Patch Changes

- chore build

## 2.3.10

### Patch Changes

- add native screen analytics

## 2.3.9

### Patch Changes

- chore types

## 2.3.8

### Patch Changes

- fix types

## 2.3.7

### Patch Changes

- add types

## 2.3.5

### Patch Changes

- add install_referrer and fix screen resolution

## 2.3.4

### Patch Changes

- chore: eslint

## 2.3.3

### Patch Changes

- fix build

## 2.3.2

### Patch Changes

- add firebase & fbsdk event

## 2.3.1

### Patch Changes

- fix getInstallReferrerAsync is not available on ios

## 2.3.0

### Minor Changes

- support react-native environment

## 2.2.11

### Patch Changes

- update deps

## 2.2.10

### Patch Changes

- update deps

## 2.2.9

### Patch Changes

- update deps
