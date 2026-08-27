# @shware/analytics

## 7.3.1

### Patch Changes

- Session housekeeping, no behaviour change.

  `Session.startTime` is now `lastTickTime`. It is where the engagement accumulator last settled up and is rewritten on every tick, so it never marked when the session began — a claim the 5.1.2 notes made and nothing in the code supported. `isVisible()` and `isFocused()` are removed, having never had a caller.

  The `getSession` docblock stops promising more than the lazy construction delivers. Deferring it lets the module be evaluated on a server, which is all it does: this instance, `cache` and `config` are module singletons, so calling `track()` on a server would share one session and one visitor across every request an isolate serves. The README now says so under **Client-side only**.

## 7.3.0

### Minor Changes

- A session now survives the page it started on.

  `Session` kept its id and its clock in memory, so a session lasted exactly as long as one document: a full page load started a new one, a second tab was a second session, and closing a tab and returning a minute later counted as two. Sessions were being counted per page view rather than per visit — events per session came out too low and session counts too high, and neither could be repaired after the fact.

  The identity and the timeout clock move into `config.storage`, which is `localStorage` on the web and the SQLite-backed shim on React Native, and is where `visitor_id` already lives. Every batch does one read-modify-write of that record — read the session, start a new one if it has timed out, stamp it, write it back — which is what GA4 does with its `_ga_<container>` cookie for every event it sends. Caching it in memory instead is what put the tabs out of step to begin with. Where storage is unavailable the wrapper's in-memory fallback takes over and sessions behave as they did before.

  Stored as `1.<id>.<lastEventTime>`: compact and cookie-safe rather than JSON, so a host that wants one session across its subdomains can hand `setupAnalytics` a cookie-backed `storage` without the format having to change. The leading version guards a change the parser could not otherwise survive; a field appended to the end does not need one.

  The timeout is measured from the events themselves rather than from the moment their batch goes out. A tab frozen in the background holds a batch far longer than the two seconds `track` aims for, and those events belong to the session they happened in, not to whichever one is current when the tab wakes up. `session_start` carries the timestamp of the event that opened the session for the same reason.

  Three changes follow from it:

  - **The hooks no longer send `session_start` themselves.** It was right when every page load was a new session; now a reload inside the timeout continues one, and the event would be a fiction. `sendEvents` emits it, at the front of the batch that opened the session — the only place that knows.
  - **A session that times out no longer inherits the engagement its predecessor never reported.** GA4 clears the same counter when it starts a session.
  - **`focus`, `pageshow` and becoming visible no longer extend the timeout.** GA4 measures it from the last event and nothing else, and the stored field means what its name says.

  `session_number` is deliberately not stored. GA4 counts sessions on the client because it has no visitor-level backend to ask at collection time; ranking `session_id` — a uuidv7, so ordered by time — over `visitor_id` or `user_id` answers the same question from stored events, and answers it across devices, which a per-device counter cannot do at all.

### Patch Changes

- `sendBeacon` no longer throws away the events it exists for.

  It refused to send unless `cache.visitor` and `cache.tags` were both populated, and those are per-document caches filled by the first batch's round trip. The beacon runs on `pagehide` and on the page becoming hidden, carrying the engagement time a visit accrued — so a visit short enough to end before its first batch came back had that engagement dropped in full, which is precisely the visit whose duration a bounce or landing-page report cares about most.

  The visitor id is persisted, and has been since the visitor was created, so a returning visitor already has one in storage before `getVisitor` has finished anything on this page; the beacon falls back to it. Tags fall back to an empty set rather than blocking the send — every field in `tagsSchema` is optional, and an event with no browser details is worth more than no event. A visitor with nothing stored is still skipped, since the server has no such visitor to attach anything to.

## 7.2.1

### Patch Changes

- Dependency upgrades: `uuid` 14.0.2 and `web-vitals` 6.2.0.

  The peer floors move up too — `@react-native-firebase/analytics` 26.3.2, `@tanstack/react-router` 1.170.32, `@tanstack/react-start` 1.168.49, `expo-crypto` 57.0.2, `next` 16.3.3 and `posthog-js` 1.419.4. All stay within their existing major, so a host already on a recent version of any of them is unaffected.

- Updated dependencies
  - @shware/utils@1.6.1

## 7.2.0

### Minor Changes

- One unusable property no longer costs the batch it travelled in.

  `createTrackEventSchema` validates a whole batch at once, and zod fails the entire parse when a single element fails — so one property that broke a limit took up to ten events down with it, plus whatever the client had queued behind them, and the client saw a 400 it could do nothing about. The limits themselves were the trigger: a value over 512 characters, a key over 128, more than 64 properties on one event. Values that overrun are exactly the ones derived from the page — a link's text, a URL carrying a long query — which no client can bound in advance, and no amount of care in a new SDK helps the versions already deployed in cached bundles and shipped apps.

  The property schemas now drop what does not fit instead of refusing it:

  - A string value over 512 characters is truncated. A shortened value is worth more than a lost batch.
  - A key that is empty or over 128 characters is dropped, and the event keeps its other properties. Keys are written by hand in instrumentation code, so an unusable one is a mistake in the host rather than something a visitor typed — but the mistake should cost that property, not the batch it happens to be in. Truncating a key is not an option, since two long keys would silently become one field.
  - Beyond 64 properties, the first 64 in insertion order are kept.

  This applies to event properties, to the nested item lists inside them, and to visitor properties, which had the same three limits written out twice. Key trimming, which the key schema used to do, still happens.

  Parsing valid payloads got faster rather than slower, which is the usual worry with a change like this: 22% on a typical eight-property event, 26% on a full ten-event batch, 29% on an event carrying 64 properties — measured against the previous schema on the same inputs, with both producing identical output. The strict version ran three checks through zod's pipeline for every key and another for every string value, plus a refine over the whole object; that is now one plain loop over the entries and a single `slice` per value, so the saving grows with the number of properties.

  A value of an unexpected _type_ still fails the batch. That is a wrong call rather than an overlong string, and there is no shortened form of it to keep.

  Separately, `useOutboundClickAnalytics` now sends at most 100 characters of `link_text`. An anchor can wrap a whole card, so its text runs to kilobytes of markup content that no report reads; 100 is what GA4 keeps of a text event parameter. This is about not shipping the bytes at all, not about the transport limit, which sits well above it.

## 7.1.1

### Patch Changes

- A third-party tracker can no longer take the rest of a batch down with it.

  `sendEvents` runs the registered `thirdPartyTrackers` inside the loop that hands each event its id, and that loop drains the queue with `shift`. A tracker that threw — a pixel script blocked by an extension, `posthog` reaching for `window` during SSR, a vendor global that never loaded — escaped to the catch below, so events the server had already accepted were reported to `onError`, while the ones ahead of them in the same batch had already been told they succeeded, and every tracker after the throwing one was skipped. Each tracker is now called inside its own try/catch and a failure is logged and stepped over. `setVisitor` does the same for `thirdPartyUserSetters`, where a throw also skipped the visitor cache write and rejected a call whose PATCH had already succeeded.

  The functions that could throw during server rendering now guard against it the way the rest of the trackers already did: `sendGAEvent`/`setGAUser` and `setRedditUser` check for `window` before the vendor global they were already testing, and `sendPosthogEvent` checks for `document`. `document` rather than `window` because React Native defines `window` as an alias of `global` — a window check passes there and then throws on `window.location`, which has no such alias. The others reach a vendor global that React Native never has, so they return before touching `location`.

  Also documents why `sendFBEvent` and `sendRedditEvent` each branch into two identical calls: `fbq` and `rdt` are overloaded per event type, and narrowing the union the mapper returns is what selects a single overload. Collapsing the branches, which is the obvious tidy-up, makes the call match none of them.

## 7.1.0

### Minor Changes

- Server-side conversions are timestamped with the event's own time, not the moment the request goes out.

  All four senders stamped `Date.now()` — Meta `event_time`, Reddit `event_at`, OpenAI `timestamp_ms`, LinkedIn `conversionHappenedAt` — while `TrackEvent.created_at`, which carries when the event actually happened, was never read by any of them. That is only harmless when the backend forwards each event the instant it arrives. Behind a queue, a retry, or a nightly batch, every conversion was dated to whenever the backend got round to it: the attribution window was measured from the wrong end, events already past the seven-day limit that Meta, Reddit and OpenAI all enforce looked fresh instead of being rejected, and the timestamp drifted away from the browser pixel's copy of the same conversion, which is timed correctly.

  Each sender reads `created_at` instead. It is a required field on `TrackEvent`, carried straight from the stored event, so there is nothing to fall back to: a caller that omits it now fails the request rather than silently having every conversion dated to the moment it was forwarded.

  Meta's synthesized `_fbc` moves with it. Where the tags carry a raw `fbclid` but no `_fbc` cookie, the sender builds one, and Meta's own instruction for that case is to use "the timestamp when you first observed or received this fbclid value" — the event's time is the closest the server has, and unlike `Date.now()` it does not move when a queued batch finally goes out. It now goes through `formatFbc` from the click-id module rather than repeating the format inline.

  `sendTestEvent` keeps `Date.now()`: it invents an event rather than forwarding one.

### Patch Changes

- `useWebAnalytics` no longer leaks its checkpoint listeners.

  The `mousedown`/`keydown`/`touchstart` listeners that keep the engagement accumulator up to date were registered with `capture: true` and removed without it. `removeEventListener` only matches a listener registered with the same capture flag, so all three stayed attached after the effect was cleaned up, and since the throttled handler is rebuilt on every effect run, each mount left another set behind — permanently, on `window`, referencing a throttle that had already been cancelled.

  Nothing was visibly wrong while the hook stayed mounted for the life of the page, which is the usual arrangement. A host that mounts it inside a subtree that unmounts and remounts accumulated a set per mount.

## 7.0.1

### Patch Changes

- Fixes in the send path, all of them failure modes that were silent and none of which the caller could see.

  - **A failed visitor request no longer disables tracking for the page.** `getVisitor` cleared its in-flight promise only after a successful await, so a rejection left the rejected promise in `visitorFetcher` and every later call re-threw the same failure. `sendEvents` awaits a visitor for every batch, so one failed request stopped the page from reporting anything until it was reloaded. The reset moved into a `finally`. `createVisitor` also parsed the body without checking the status: a 5xx whose body was JSON produced a `Visitor` with no `id`, which was then cached and sent as `visitor_id: undefined` on every subsequent batch, each rejected by the events schema. It throws on a non-ok response now.
  - **A link lookup that comes back empty is retried.** The per-page cache added in 7.0.0 kept a null answer forever, and `getLink` answers null for a network failure as well as for a link that does not exist — so one failed lookup dropped the `?s=` link's utm params from every later event on the page. The once-per-batch call it replaced would have retried on the next flush.
  - **The web device id goes through `config.storage`.** `getDeviceId` touched `localStorage` directly, on two counts wrongly. It bypassed the store the host passed to `setupAnalytics`, so a host that supplied its own kept `device_id` in `localStorage` while `visitor_id` and `first_visit_time` went where it asked. And the default `storage` export wraps those calls in try/catch precisely because reading site data throws in a third-party iframe, in some embedded webviews, and wherever the browser blocks it — the throw propagated out of `getTags`, so those visitors produced no tags at all. The id now lands in the same store as every other key, falling back to an in-memory map when the read throws.
  - **A short response no longer throws mid-loop.** The loop handing each event its id read `data[index].id` unguarded while draining the queue with `shift`, so a response with fewer ids than events threw partway through: the events already shifted off had been told they succeeded, and the catch reported failure to whatever was left. It reads `data.at(index)?.id` now and reports success without an id, which the callback's optional argument already allowed for.
  - **A batch that fills up cancels its pending timer.** Reaching `batch` sent the queue and returned without touching the timer the previous push had armed, leaving it to wake up later and flush an empty queue. Both paths go through one `flush` now. No visible change beyond the wasted wakeup: the next push already cleared the stale timer before arming its own.

## 7.0.0

### Major Changes

- Tags are captured when the event happens, not when its batch is sent.

  `track()` queues events and flushes them up to 2 seconds later, or once 10 have piled up, and `sendEvents` called `config.getTags()` once at that point for the whole batch. A single page app that navigated inside that window therefore stamped every pending event with the URL of the page the user had already left — the events immediately before a route change, which are usually the interesting ones. `getTags` also ran after the rate limiter's wait, widening the gap further.

  `getTags()` is now called by `track()` at the moment the event is queued, and each event carries its own tags to the flush. The contract is "the tags as of now, for this event". Nothing changes on the wire: a batch already serialized a full copy of the tags per event, since JSON has no references.

  Implementations have to be cheap enough to run per event, and two shipped ones were not:

  - `@shware/analytics/web` resolved the `?s=` link with an uncached `getLink()` request. It is now cached per link id for the lifetime of the page, and the page fields are read before that lookup is awaited — otherwise the await would reintroduce the very skew this change removes.
  - `@shware/analytics/native` called `getIosIdForVendorAsync()` and `getInstallReferrerAsync()` on every call. Neither answer changes while the app runs, so both are resolved once and the promise reused; a failed lookup is not cached, so the next event retries.

  A host that passes its own `getTags` should check the same thing: no network request, no unmemoized native call. If it throws, the event is now sent with the last built tags instead of taking the batch down with it, since the promise sits in the queue with nothing awaiting it and an unhandled rejection would surface as a global error first.

  `sendBeacon` still uses `cache.tags`, the last tags built by any of these calls. It runs during `pagehide`, where building fresh tags is not worth the risk of losing the event.

- The `source_url` tag is now `page_location`, and `page_title` joins it.

  The tag layer's page fields were named from two vocabularies at once: `page_referrer` after GA4, `source_url` after Meta's `event_source_url`. GA4 is the better fit for both, because it describes what this layer actually is — gtag sends `page_location`, `page_referrer` and `page_title` with _every_ event, not only with `page_view`, and exposes `page_location` as a global `gtag('set', ...)` value. That is exactly what a tag is here. The Meta and OpenAI mappings are one line each, written once; a tag name is typed into report queries for years, and `page_location` next to `page_referrer` reads as one pair.

  `SourceInfo` is accordingly renamed to `PageInfo` and now holds `page_location`, `page_referrer` and `page_title` — the same three fields gtag sends. It was never exported from an entry point, so only the shape matters. `page_title` is new, filled from `document.title` by `@shware/analytics/web`.

  No page path is stored: GA4 does not send one either, deriving that dimension from `page_location` in reporting. `split_part` at query time costs less than a second source of truth that can disagree with the URL.

  Migration:

  - Report queries move from `tags->>'source_url'` to `tags->>'page_location'`; `COALESCE` the two for as long as rows written by older SDKs still matter.
  - Hosts passing their own `getTags` should rename the key. Nothing breaks loudly if they miss it — `TrackTags` has an index signature, and `tagsSchema` strips unknown keys — but `source_url` will be dropped at the boundary, and Meta's `event_source_url` and OpenAI's `source_url` will go out empty, which degrades both match rates.
  - `page_location`, `page_referrer`, `page_title` and `page_path` stay on the `page_view` and `first_visit` properties as before. They are redundant with the tags now, deliberately: they are convenient to query without reaching into the tag blob.

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
