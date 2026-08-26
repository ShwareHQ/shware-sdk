# @shware/analytics

## 6.0.0

### Major Changes

- The `source` tag is gone. Every conversions API's action source is now derived from `event.platform`.

  `TrackEvent` has carried `platform` and `environment` as top-level fields since 5.0, so they could be queried as columns instead of being dug out of a JSON blob — but nothing server-side ever read them. All three senders classified the event from `tags.source` instead, a tag with exactly two producers: `@shware/analytics/web` hard-coded `'web'`, `@shware/analytics/native` hard-coded `'app'`. Both are restatements of the platform the host already declares in `setupAnalytics`, sent on every event, and trusted from the client without ever being checked against it.

  `source` is therefore removed from `SourceInfo`, from `TrackTags`, and from the tags schema. `server/action-source.ts` derives the value instead:

  | `event.platform`            | action source |
  | --------------------------- | ------------- |
  | `web`                       | `web`         |
  | `ios`, `android`            | `app`         |
  | `macos`, `windows`, `linux` | `app`         |
  | `unknown`                   | — (see below) |

  This fixes the meaning of the desktop platforms rather than preserving it: previously the answer came from which entry point the host imported, so an Electron app on `@shware/analytics/web` was a website and a React Native desktop app was an app, with `platform: 'macos'` having no say either way. Now `platform` decides. **A host that declares `macos`/`windows`/`linux` is declaring a desktop app**; a page running in a webview that wants website semantics should declare `platform: 'web'`.

  Offline conversions are not derivable — `offline` describes how a conversion was collected (in store, imported from a CRM, taken over the phone), not what device it came from, and those events are built by a backend rather than reported by a client SDK. It is now an explicit trailing argument on the senders instead of a value a client could put in a tag:

  ```ts
  sendMetaEvents(accessToken, pixelId, events, data, appPackageName, 'offline');
  sendRedditEvents(accessToken, pixelId, events, data, testId, 'offline');
  sendOpenAIEvents(apiKey, pixelId, events, data, validateOnly, 'offline');
  ```

  The argument is typed `EventActionSource` (`'web' | 'app' | 'offline'`), exported from `@shware/analytics/server`, and overrides the derived value when present. It reaches OpenAI as `action_source: 'offline'`. Meta has no generic offline value — `physical_store` and `system_generated` are narrower claims only the caller can make — so it lands in Meta's `other`, and Reddit, which documents `WEBSITE` and `APP` only, receives `UNKNOWN`.

  Also fixed: a Meta server event whose action source could not be determined left `action_source` unset, and Meta requires the field. It now falls back to `other`.

  Migration:

  - Hosts that pass their own `getTags` should drop `source` from it. Nothing breaks if they don't — `TrackTags` has an index signature, so it still type-checks, and `tagsSchema` strips unknown keys, so the value is silently discarded server-side. Make sure `platform` in `setupAnalytics` is right instead, since it now decides how conversions are classified.
  - Backends that read `tags.source` from stored events should read the `platform` column. Rows written by older SDKs keep their `source` tag; it is redundant with `platform` for all of them.
  - `@shware/analytics/web` also stopped putting `platform` and `environment` into its tags. Neither was ever declared in `tagsSchema`, so both were already being stripped before they reached storage; this only removes the dead weight from the request body.

## 5.1.2

### Patch Changes

- Nothing is constructed at module scope anymore, so the package can be evaluated on Cloudflare Workers.

  Two module-scope singletons made importing the SDK fatal in a Worker. `setup/session.ts` ended in `export const session = new Session()`, and that constructor calls `uuidv7()`, which reads `crypto.getRandomValues`. `track/index.ts` had `const tokenBucket = new TokenBucket(...)`, whose constructor starts a refill `setInterval`. Workers forbid both outside a request handler, because module scope is evaluated once when the isolate boots and is then shared by every request it serves:

  ```
  Disallowed operation called within global scope. Asynchronous I/O
  (ex: fetch() or connect()), setting a timeout, and generating random values
  are not allowed within global scope.
  ```

  Every entry point reaches `track()`, so a host that server-renders on Workers — TanStack Start, Next, or React Router deployed to Cloudflare — took the throw while the isolate was starting, before any component rendered: a 500 on every route, not just the tracked ones. It stayed invisible in `vite dev`/`next dev`, where SSR runs in Node and a module-scope `getRandomValues` or `setInterval` is unremarkable; it only appeared under `wrangler dev` or in production. The workaround was to keep the SDK out of the server bundle by hand, importing it dynamically behind a mounted check — which also pushed `<Analytics gaId>`'s gtag snippet past hydration, exactly the delay a Tag Gateway exists to avoid.

  Both are now created on first use, by `getSession()` and internally by the first send. Importing the module runs nothing, so `<Analytics>` and `track()` can sit in a server-rendered tree again; `dist/index.mjs`, `dist/web/index.mjs` and `dist/tanstack/index.mjs` were verified to boot under `wrangler dev`. `session.startTime` is also more honest: it marks when the session began rather than when the isolate happened to start.

  `session` was never part of the public API — no entry point re-exported it and `./setup/session` is not in the `exports` map — so nothing changes for consumers.

## 5.1.1

### Patch Changes

- `sendMetaEvents`/`sendMetaEvent` no longer reject when Meta rejects the batch. Every other conversion sender in `@shware/analytics/server` logs the failure and resolves, so a host that fans out to all of them with `Promise.all` had its request fail whenever Meta alone returned a 4xx — most often locally, where an event carries no `fbp`/`fbc` and no client IP and Meta answers `error_subcode: 2804050` (customer information parameters missing or too broad). Meta failures are now logged in the same shape as the Reddit and OpenAI senders, and only the response body is logged: the raw SDK error also carries the access token in its `url`.

## 5.1.0

### Minor Changes

- Refresh `visitor.tags` on every visit. A returning visitor was fetched with `GET /visitors/:id`, which sends no body, so the only thing that ever wrote `tags` again was `setVisitor` — and hosts call that when they identify a user. Anyone who never signed in therefore kept the browser, screen, and release captured on their first ever page load, leaving `tags` permanently equal to `initial_tags`. The lookup is now a `PATCH` carrying the current `getTags()`, so `tags` is genuinely last-touch. It replaces the existing request rather than adding one.

  Backends need to be ready for it: `PATCH /visitors/:id` now runs on every visit, not just at identify, and any side effect that previously lived on the `GET` (server-derived fields such as IP geolocation) has to move there too, or it will silently stop being refreshed. Derive those fields after merging the client's tags so a caller cannot spoof them.

## 5.0.0

### Major Changes

- `useTrackImpression` drops its element type parameter and returns a callback ref: the signature is now `useTrackImpression<T extends EventName>(name, properties?): RefCallback<Element>`.

  The old signature `<R extends Element = HTMLDivElement, T extends EventName = EventName>` put two independent axes in one type-argument list. TypeScript has no partial type-argument inference, so writing `useTrackImpression<HTMLDivElement>(...)` to name the ref element silently pinned `T` to its loose `EventName` default and bypassed the standard-event payload typing (e.g. `view_promotion`'s required `items`) — and lint autofixes that strip a type argument equal to its default re-broke inference the other way. A callback ref is contravariant in the element type, so it attaches to any element without an `R` parameter; `name` is now the only inference site and explicit type arguments are never needed.

  Also fixes a missed-impression bug: the old implementation observed `ref.current` from an effect keyed on `[ref.current]`, which never re-runs when a ref mutates, so elements that mounted after the first render were never observed. The node now flows through state, and late-mounted elements are tracked.

  Migration:

  - Remove explicit type arguments: `useTrackImpression<HTMLDivElement>('view_promotion', p)` → `useTrackImpression('view_promotion', p)`.
  - Payloads for GA4 standard events are now actually type-checked; `view_promotion` requires `items: (Item & PromotionItem)[]`.
  - The return value is a `RefCallback<Element>`, not a `RefObject` — code reading `.current` from it must create its own ref and compose the two.

## 4.2.0

### Minor Changes

- Support `@react-native-firebase/analytics` 26 and `web-vitals` 6.

  - RNFB 26 made the modular `logEvent` fire-and-forget (`void` instead of `Promise<void>`), so `sendFirebaseEvent` no longer awaits it. The function itself stays `async` and callers that await it keep compiling; the await simply no longer tracks the native call, which RNFB does not report on either. Peer range moves to `^26.0.0`.
  - `web-vitals` moves to `^6.0.1`. `Metric` gains `navigationId` and `'soft-navigation'` as a `navigationType`, so a reporter that exhausts `navigationType` needs the extra branch. `useReportWebVitals` reports the same CLS, LCP, INP, FCP and TTFB and does not opt into `reportSoftNavs`, so soft navigations still produce no metrics at runtime.
  - Peer ranges follow their upstreams: `next@^16.2.12`, `posthog-js@^1.409.5`, `react-native@^0.86.2`, `react-router@^8.3.0`, `@tanstack/react-start@^1.168.34`.

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
