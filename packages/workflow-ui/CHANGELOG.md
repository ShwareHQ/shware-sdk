# @shware/workflow-ui

## 2.2.16

### Patch Changes

- Updated dependencies [e8cd01d]
  - @shware/workflow@12.5.1

## 2.2.15

### Patch Changes

- Updated dependencies [2f5a441]
  - @shware/workflow@12.5.0

## 2.2.14

### Patch Changes

- Updated dependencies [354ce34]
  - @shware/workflow@12.4.1

## 2.2.13

### Patch Changes

- Updated dependencies [c456a34]
  - @shware/workflow@12.4.0

## 2.2.12

### Patch Changes

- c10f06f: `trigger.date` runs, and takes a `filter`.

  `@shware/workflow`

  - **`trigger.date(at, { filter })` starts a journey, once, for every known user the filter holds for when the time comes.** `trigger.date('2026-11-27 09:00:00', { filter: purchaser })` is how to send to an audience at a time: each user is asked at that moment, so long-standing members of a segment enter like recent ones (unlike `trigger.enters`, which waits for someone to become one). Without a filter every known user enters; visitors do not. The filter is checked before an instance exists, so a user it turns away has not entered. `at` is `'YYYY-MM-DD HH:mm:ss'` in UTC and is now validated: anything else, or a date the calendar lacks, throws when the workflow is built.
  - **The scheduled sweep does the starting**, 500 users a page, with its place kept in the store: a sweep spends about 25 seconds on date triggers and the next carries on, and one that is cut off loses nobody and repeats nobody (the occurrence in the entry ledger is the trigger's time). The send therefore begins at the first sweep at or after the time, and a large audience takes several sweeps. The sweep's result (`POST /segments/sweep`, `worker.sweep`) gains `dates`: what it did for each date trigger. On AWS each page is a durable step (`sweep:date:<n>`).
  - **A time runs once.** The run is identified by the workflow and the time, recorded at the first deploy that carries it: redeploying does not repeat it, a deploy landing just after the time does not cancel it, and another time is another run under the workflow's `reentry` policy. A time already past at that first deploy is not run, nor is one no sweep began within a day of its time. A start that fails is retried by the next sweep without holding up other date triggers, and a user who still cannot be started a day after the time is passed over.
  - **What changes for you: a workflow on `trigger.date` used to deploy and never start** (`deployBundle` listed it in `unrouted`). One whose time is still ahead when this version deploys will now fire, to every known user unless it has a filter. Check the date triggers you have. `unrouted` now lists webhook triggers only.
  - **Migration required:** two new tables, `date_trigger` and `date_run` — regenerate the drizzle file (`workflow-ui generate`) and run the migration before the new version serves; `POST /bundle/deploy` answers 503 without them.
  - `JourneyStore` gains `dueDateTriggers`, `listDateCandidates` and `advanceDateRun`. `@shware/workflow/cloudflare` exports `sweepDateTriggers`, `fanOutDatePage`, `DATE_TRIGGER_GRACE_MS` and `DATE_FANOUT_BUDGET_MS`.

  `@shware/workflow-ui`

  - The canvas marks a date trigger that has a filter.

- Updated dependencies [c10f06f]
  - @shware/workflow@12.3.0

## 2.2.11

### Patch Changes

- Updated dependencies [434d477]
  - @shware/workflow@12.2.0

## 2.2.10

### Patch Changes

- 512f960: A journey can read the event that started it, an event's payload has a size limit, and following an unsubscribe link is no longer a click.

  `@shware/workflow`

  - **`trigger.event()` returns a handle on the triggering event.** `const checkout = trigger.event(e.begin_checkout)`, then `checkout.payload.<field>` — typed by the event — goes wherever a profile property can: a predicate (`branch`, `filter`, `waitUntil`, the goal, `exitWhen`), a message prop, a `sendEvent` payload, an action argument. Until now a journey could only test the event log (`performed(e.begin_checkout, (p) => gte(p.value, 100), { within: '1 day' })`), which answers for any occurrence in the window, not the one that entered. The value is a snapshot: the journey reads the payload it entered with for as long as it runs. Scalars only — a nested field is reached by its path (`checkout.payload.cart.items`), and an object, an array or a field the event left out reads as missing. `compileBundle` refuses a reference taken from another trigger, one in a workflow with a segment, date or webhook trigger, and one in a segment or a trigger `filter`; with a contract, `compileConfig` checks every field read is one the event declares, and `checkInFlight` reports a field a running journey reads that a deploy would drop from the contract. In IR the references are new optional forms (`trigger_payload`, as a condition and as a value): `irVersion` is unchanged and so is every existing content hash. Existing code needs no change — `trigger.event()` still returns a `TriggerRef`.
  - **An event's payload may be at most 128 KiB as JSON** (`MAX_EVENT_PAYLOAD_BYTES`). `POST /ingest` and a queued batch refuse a larger one with a 400 naming the event and its size; `ingestEvent` called directly throws `EventPayloadTooLargeError` (a 413 from `handleRequest`). A triggering event's payload travels in the instance's parameters, which the runtimes cap (Cloudflare Workflows at 1 MiB), so an oversized one used to surface as an instance that failed to start. **If you send payloads over 128 KiB, they are now refused.**
  - **Following an email's unsubscribe link is not a click of the copy.** The click is still recorded and still counts as an open, but it no longer sets `clicked_at` / `human_clicked_at`, so click rates are about the links of the content. **Migration required:** `message_link` gains a nullable `purpose` column — regenerate the drizzle file (`workflow-ui generate`) and run the migration before the new version serves. Migrating first is safe (the previous version ignores the column); deploying first is not: tracked email sends fail and tracked links answer 500 until the column exists. `POST /bundle/deploy` answers 503 without it. No data step: links recorded before keep a null purpose, so unsubscribe clicks on emails already sent go on counting. `JourneyReporting.recordLinks` takes `{ url, purpose }` entries as well as bare URLs.

  `@shware/workflow-ui`

  - The canvas labels a condition on the triggering event's payload as `trigger.<field>`, and the inspector lists its value.
  - The links report leaves out clicks on unsubscribe links. It reads the new `message_link.purpose` column, so upgrade it together with `@shware/workflow` and run the migration first.

- Updated dependencies [512f960]
  - @shware/workflow@12.1.0

## 2.2.9

### Patch Changes

- c78b7a5: Fixes from the workflow review, fourth batch.

  `@shware/workflow`

  - An `observer` passed to `journeyWorker` / `journeyLambda` is added to the store's own instead of replacing it. The store's observer holds the claim that delivers each copy at most once; a host that passed one of its own, to hear of sends or finished journeys, silently lost that guarantee (a replayed step sent the copy again) along with the store's reporting. **What changes for you:** with a custom observer the store now records instances, copies and engagement as it does without one, emails get their tracking links and pixel when `WORKFLOW_ORIGIN` is set, and your hooks run after the store's (tracking your `messagePrepared` returns is laid over the store's). An observer that implements `messageSettled`, `messageClaimed` or `messageReleased` — `reportingObserver(...)` spread into your own object, say — decides delivery itself and is still used alone.
  - Web Push: a subscription's endpoint is only sent to when it is an https URL on a browser's push service — `fcm.googleapis.com`, `android.googleapis.com`, `jmt17.google.com`, `*.push.services.mozilla.com` (and Mozilla's two stage and dev hosts), `*.notify.windows.com`, `*.push.apple.com`: the hosts of Pushpad's `known-push-services` list, which is drawn from some 200M real subscriptions. The endpoint is the registering client's word, and the host POSTed to whatever it named, `https://localhost` or an internal service included. `POST /devices` with `platform: 'web'` now answers 400 for any other endpoint (and for a token that is not a subscription as JSON); one already stored is settled undelivered (`UnlistedPushService`) at each send, without a request, and its device is kept. **If you deliver through another push service, name its host in the new `webPush.pushServices`** (`['push.example.com']`, or `'*.example.com'` for subdomains): until then its devices get nothing. `@shware/workflow/webpush` exports `PUSH_SERVICE_HOSTS`, `isPushServiceEndpoint` and `subscriptionEndpoint`, and `WebPushSender` takes `pushServices`.
  - `timeWindow({ tz })` throws a `TypeError` naming the zone when it is not `'user'` or a time zone the runtime knows. A misspelled zone compiled and was read as UTC at every window.
  - README: a completed Cloudflare Workflows instance's state is kept 7 days by default, up to 30 on a paid plan (it said 30).

  `@shware/workflow-ui`

  - Canvas: a branch whose fall-through (no `otherwise`) had an arm on the centre line — three arms, five — drew the fall-through connector through that arm's cards. It now runs down the empty arm's own column and rejoins below the arms.
  - Canvas: the selected node is remembered per workflow again. It was stored under the node's id, so a reload never found it.
  - The dev server also refuses to serve `.npmrc`, `.envrc`, `.netrc`, `wrangler.toml` / `wrangler.json` / `wrangler.jsonc`, `*.p12`, `*.jks` and `*.keystore`.

- Updated dependencies [e13b7b4]
- Updated dependencies [c78b7a5]
  - @shware/workflow@12.0.7

## 2.2.8

### Patch Changes

- Updated dependencies [755dcec]
  - @shware/workflow@12.0.6

## 2.2.7

### Patch Changes

- Updated dependencies [086ea20]
  - @shware/workflow@12.0.5

## 2.2.6

### Patch Changes

- 47ff5f5: Fixes from the workflow review, first batch.

  `@shware/workflow`

  - A host with no `API_TOKEN` and no `authorize` now runs open only in a mode named for it: `development`, `test`, or a mode with a `runtime` entry in the config. Any other `ENVIRONMENT` (`prod`, `Production`, an undeclared `staging`) is refused with a 503 like production, instead of serving every route open. **If you run an undeclared mode open on purpose, give it a `runtime` entry or set `API_TOKEN`.**
  - `POST /t/p/<id>` and `POST /t/d/<id>` take a push copy's id only. An email's id — present in every link of the email — no longer records a human open or hands the host a `pushOpened` event for its recipient.
  - A goal on the trigger's own event (a repeat purchase) no longer converts at entry on the very event that started the instance.
  - `waitUntil` no longer counts an event that happened after its deadline when the check runs late.
  - Instance ids sanitize the workflow id: a `.` or `/` in it made Cloudflare refuse every start (`instance.invalid_id`).
  - VAPID tokens expire after 18 hours instead of exactly 24, so a host clock that runs fast is not refused by the push service.
  - AWS: `findExecution` asks by function and name only; Lambda refuses a name filter combined with a qualifier.

  `@shware/workflow-ui`

  - `plan` reads the pinned journeys unless the entry ledger itself is missing; any other missing table used to report "nothing is pinned" and a safe deploy.
  - The CLI loads `plan` on demand, so the studio, `generate` and `--help` work without the optional `postgres` peer.
  - A `waitUntil` card says whether its timeout exits or continues.

- Updated dependencies [47ff5f5]
  - @shware/workflow@12.0.4

## 2.2.5

### Patch Changes

- a836d52: Upgrade the studio's runtime dependencies (TanStack Query, React Flow, i18next, react-i18next, the language detector, lucide-react and tailwind-merge) to their latest releases.
- Updated dependencies [a836d52]
  - @shware/workflow@12.0.3

## 2.2.4

### Patch Changes

- 74cabab: Update dependencies to their latest versions (`@posthog/types` 1.425, `cookie` 2.0.2, `jose` 6.2.17, `@slack/types` 3.3, `discord-api-types` 0.38.59, the bundled `bowser` 2.15, and the dev toolchain: vitest 5.1, tsdown 0.23.7, oxlint 1.94, oxfmt 0.79, pnpm 12). `path-to-regexp` stays on 8.x in `@shware/security`: 9.0 is ESM-only and moves the greedy match in multi-parameter segments, which would change what `param()` returns.
- 74cabab: Move the studio to `@xyflow/react` 13, `i18next` 27 and `react-i18next` 18. The canvas passes its colour mode through `forceColorMode` (react-flow 13 renamed `colorMode`); react-flow 13 also fits the view with 5% padding instead of 10%.
- Updated dependencies [74cabab]
- Updated dependencies [74cabab]
  - @shware/workflow@12.0.2

## 2.2.3

### Patch Changes

- Updated dependencies [7f7d41b]
  - @shware/workflow@12.0.1

## 2.2.2

### Patch Changes

- Updated dependencies [9bb654e]
  - @shware/workflow@12.0.0

## 2.2.1

### Patch Changes

- Updated dependencies [336f47b]
  - @shware/workflow@11.0.0

## 2.2.0

### Minor Changes

- 0c02072: `workflow-ui plan --database-url <url>` (or `DATABASE_URL`): the deploy-time check run before the deploy. It compiles the project, reads which workflow versions journeys are still running on, and holds the bundle and this code's templates against them (`checkInFlight`); it prints the pinned versions, the migrations the database still lacks and what would break, and exits non-zero on a problem. On Cloudflare a new version's code serves the moment it is published, so this belongs in CI ahead of `wrangler deploy`.

### Patch Changes

- Updated dependencies [0c02072]
  - @shware/workflow@10.0.0

## 2.1.17

### Patch Changes

- Updated dependencies [2547a8c]
- Updated dependencies [2547a8c]
  - @shware/workflow@9.2.1

## 2.1.16

### Patch Changes

- Updated dependencies [c8e7a77]
  - @shware/workflow@9.2.0

## 2.1.15

### Patch Changes

- Updated dependencies [2f6b32e]
  - @shware/workflow@9.1.0

## 2.1.14

### Patch Changes

- Updated dependencies [c4650e3]
  - @shware/workflow@9.0.3

## 2.1.13

### Patch Changes

- 5cc4461: Narrow the studio dev server's `server.fs.allow` from the whole workspace to what the page imports: the studio package, the project directory (and the config's directory), the workspace packages the project links in through `node_modules`, and each workspace root's `node_modules` (pnpm's virtual store). A sibling app's source and files are no longer one `/@fs/` request away; the credential deny list still applies.

## 2.1.12

### Patch Changes

- Updated dependencies [72537ea]
  - @shware/workflow@9.0.2

## 2.1.11

### Patch Changes

- Updated dependencies [e532355]
  - @shware/workflow@9.0.1

## 2.1.10

### Patch Changes

- Updated dependencies [2d4e863]
  - @shware/workflow@9.0.0

## 2.1.9

### Patch Changes

- Updated dependencies [6c9f317]
- Updated dependencies [6c9f317]
- Updated dependencies [6c9f317]
  - @shware/workflow@8.0.0

## 2.1.8

### Patch Changes

- Updated dependencies [aa676c1]
  - @shware/workflow@7.0.0

## 2.1.7

### Patch Changes

- 9168625: The Studio dev server sends no CORS headers (`server.cors: false`) and refuses to serve credential files through `/@fs/`: `.dev.vars*`, `*.p8`, `*.plist`, `google-services.json`, `*.pfx`, `*.pem` and `*.key`, on top of Vite's default deny list.
- Updated dependencies [9168625]
- Updated dependencies [9168625]
- Updated dependencies [9168625]
  - @shware/workflow@6.1.1

## 2.1.6

### Patch Changes

- ebda232: The templates page previews an email's preferences link (`email.preferencesUrl`) with the placeholder message id a sent copy's would replace, so a layout's footer shows as it is sent.
- Updated dependencies [ebda232]
  - @shware/workflow@6.1.0

## 2.1.5

### Patch Changes

- Updated dependencies [3368cd5]
  - @shware/workflow@6.0.0

## 2.1.4

### Patch Changes

- ac5cb31: Update dependencies to their latest versions within the declared ranges (react 19.3.1, @tanstack/* , posthog-js, jose, stripe, discord-api-types and the rest); `tsdown` stays pinned at 0.23.1 because 0.23.2 pulls a dts plugin that refuses TypeScript 7 without `isolatedDeclarations`.
- Updated dependencies [ac5cb31]
  - @shware/workflow@5.0.1

## 2.1.3

### Patch Changes

- Updated dependencies [25a78ac]
  - @shware/workflow@5.0.0

## 2.1.2

### Patch Changes

- Updated dependencies [bdda7ce]
  - @shware/workflow@4.1.1

## 2.1.1

### Patch Changes

- Updated dependencies [0832a8d]
  - @shware/workflow@4.1.0

## 2.1.0

### Minor Changes

- da8ebed: `postgresStats` reads the data on the production clock by default (`environment: 'production'`, time scale 1): the README example pointed at a production database while the default applied the development time scale, which stretched every timestamp. The full-page template preview is sandboxed like the thumbnails (no scripts run in the studio's origin); the config and stats files cannot be fetched through Vite's `/@fs/`; the metrics view tells loading, failed and empty apart; cohort weights display as percentages; a route parameter such as `constructor` answers not-found instead of crashing the page.

### Patch Changes

- Updated dependencies [da8ebed]
- Updated dependencies [da8ebed]
  - @shware/workflow@4.0.0

## 2.0.6

### Patch Changes

- Updated dependencies [d578d1d]
  - @shware/workflow@3.3.0

## 2.0.5

### Patch Changes

- Updated dependencies [2a3c41b]
  - @shware/workflow@3.2.0

## 2.0.4

### Patch Changes

- Updated dependencies [1f5a21c]
  - @shware/workflow@3.1.0

## 2.0.3

### Patch Changes

- Updated dependencies [401288f]
  - @shware/workflow@3.0.0

## 2.0.2

### Patch Changes

- f3114ee: Preserve optional chat markup capture fallbacks while removing redundant fallbacks for required captures.
- f3114ee: Model missing flag loaders explicitly so unknown country codes continue to render no flag.
- f3114ee: Normalize Tailwind utility ordering and documentation formatting with the repository formatter.
- f3114ee: Use the validated push notification title directly in workflow previews.
- f3114ee: Model absent statistics query rows explicitly while preserving empty-data and null-activity fallbacks.
- f3114ee: Align test mocks and fixtures with their real SDK contracts, exercise TanStack middleware through its actual builder, and remove unused test imports. No runtime behavior or API dependencies change.
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
- Updated dependencies [f3114ee]
  - @shware/workflow@2.0.1

## 2.0.1

### Patch Changes

- 91b6d3b: Show copy success only after a successful clipboard operation and always remove the fallback textarea and restore focus.
- 91b6d3b: Hide stale country flags immediately when the selected country changes and ignore outdated asynchronous flag loaders.
- 91b6d3b: Expose Floating UI ref setters as typed callbacks without changing their identities or interaction behavior.
- 91b6d3b: Preserve Slack preview text and action component identity when preview settings change.
- 91b6d3b: Subscribe to system color scheme changes through an external store while preserving explicit saved theme preferences.

## 2.0.0

### Major Changes

- d576dc1: The studio follows `@shware/workflow`'s per-template email metadata: a template's detail shows its own sender, reply-to and resolved unsubscribe link, previews render inside the same `EmailProvider` the Worker's renderer uses (so a layout's `useEmailContext()` works), and Settings shows the config's `email` (default unsubscribe link, quick-click window) instead of a global envelope. `ResolvedStudioConfig.emailDefaults` is replaced by `email`, and `useEmailPreview` takes the config's `email`.

### Patch Changes

- Updated dependencies [d576dc1]
  - @shware/workflow@2.0.0

## 1.0.1

### Patch Changes

- 51f8898: The workflow detail's "Workflow" tab links to `/workflows/<id>/workflow` again (it linked to `/workflows/undefined/workflow`), and shows as the active tab on the canvas.

## 1.0.0

### Major Changes

- bf1779c: The studio reads projects on `@shware/workflow`'s template ids: its template views, previews and message links find a template by its `id` rather than by the property the registry holds it under, and the preview helpers no longer take a key.

### Patch Changes

- Updated dependencies [bf1779c]
  - @shware/workflow@1.0.0

## 0.1.3

### Patch Changes

- a9ed686: Upgrade dependencies to their latest versions.
- a9ed686: Ship `@fontsource-variable/inter` as a dependency: the studio's stylesheet imports it and Vite compiles that stylesheet in the host project, so it was unresolved under strict installs. Drop two unused devtools dev dependencies.
- Updated dependencies [a9ed686]
- Updated dependencies [a9ed686]
- Updated dependencies [a9ed686]
  - @shware/workflow@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [198edf5]
  - @shware/workflow@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [cea4727]
  - @shware/workflow@0.2.0

## 0.1.0

### Minor Changes

- f9db1db: Discord and Slack templates in the studio: listed with the other templates and previewed as their client draws them — Discord's webhook message with its embeds (fields, images, footer), Slack's Block Kit blocks (header, section with fields and accessory, divider, context, actions, image) — in light and dark, with the props editor and refused content shown as for push.
- f9db1db: Follows IR v2: `WorkflowReport.id` and `SegmentReport.id` replace `name`, the workflow and segment pages live at `/workflows/$id` and `/segments/$id`, and the Postgres stats read the `segment` table's `id` column.
- f9db1db: Breaking: `MetricPoint` requires `entered` — the users who entered the workflow in the bucket — and `converted` is now that cohort's conversions, so the Converted card is a share of users (`converted / entered`) instead of a share of delivered messages. The Overview cards headline the whole range (the sent total, and each rate over the whole range) and compare it with the range of the same length just before, instead of the last bucket against the one before it — which made the headline the day still in progress, small and jumpy, and 0 whenever sending paused.
- f9db1db: The studio keeps one design and drops every compatibility path: it reads only `export default defineConfig({...})` from `@shware/workflow` in workflow.config.ts (or `--config`) and compiles it with `compileConfig` — the studio's own `defineConfig`, `WorkflowUIConfig`, `EmailSettings`, the convention-based discovery (`src/workflows/`, `src/emails/index.ts`, `src/pushes/index.ts`, `src/slack/index.ts`, `src/discord/index.ts`), the action-manifest shim and the config-borne `stats` are gone, and a missing config, a default export that is not `defineConfig({...})`, a registry entry that is not an `emailTemplate` / `pushTemplate` (named by key) or a registry not exported from a module of its own is a clear error in place of the views. Registries hold only template definitions: the legacy email/push modules (`LegacyEmailModule`, `LegacyPushModule`, `EmailModule`, `PushModule`), their envelope fields (to, cc, bcc, preheader, headers), verbatim `{prop}` push rendering, `name`-based labels and the unavailable-template handling are removed, and so are the Slack/Discord registries and previews (`ChatModule`, the chat preview) — messages on those channels still appear on the canvas, without a preview, and the template list shows email and push only. The address book becomes a read-only view of `emails.from` / `replyTo` (`ResolvedStudioConfig.addresses`, `slack`, `discord` and `unavailable` are removed). Stats stay in the optional `workflow.stats.ts` (`defineStats`).
- f9db1db: `@shware/workflow-ui/postgres`: `postgresStats({ config, connectionString })`, a complete stats source over the reporting a journeyWorker on Postgres keeps (workflow overview, node counts, message metrics split into human and machine opens and clicks, links, segments and their members), read on the journey's clock in a fast-forwarded environment. `workflow-ui generate --out <file> [--check]` writes the engine's tables as one drizzle file on the config's database schema, and `--check` fails when the file is out of date.
- f9db1db: The studio reads the project: workflow.config.ts default-exports `defineConfig({...})` from `@shware/workflow`, and its `workflows`, `segments`, `actions`, `templates` registries, `title` and `emails` envelope are what the studio shows — nothing is scanned — compiled with `compileConfig`, so the lists match what the Worker deploys; a `ConfigCompileError` (or a config that fails to load) is shown in place of the views with the workflow and node it names. The config is evaluated on the dev server (Vite SSR, with source maps on, so captured node positions are lines on disk); the browser receives the compiled IR as JSON and imports only the two template registries from the modules that export them, never the config, its contract, runtime settings or host dependencies. Adding or removing a workflow or template in the registration list updates over HMR. The stats source is an optional `workflow.stats.ts` (`defineStats`, or `--stats <path>`). `ResolvedStudioConfig.workflows` holds compiled `WorkflowIR` keyed by workflow name, `segments` holds `SegmentIR`, and it gains `error` and `emailDefaults`; the `@jridgewell/trace-mapping` dependency is gone.
- f9db1db: A `push_web` metric channel (browser notifications). `postgresStats` counts an iOS or web push as delivered when the device reported it (an iOS notification service extension, a browser's service worker), not when APNs or the push service accepted it; email and Android keep the transport's acceptance.
- f9db1db: Workflow Studio is now read-only: it shows the workflow graph, node details, email and push previews, the email envelope and stats, and never changes the project. The source write-back is gone — the `/__studio/envelope` and `/__studio/addresses` routes and POST `/__studio/node` answer 404 / 405 (`GET /__studio/node` remains, only to map a node to its line on disk), along with the inspector and envelope editors, the edit dialogs and row menus (`WorkflowList` / `EmailList` lose `onEdit`, `TemplatesPage` loses `addresses`, `onSaveEnvelope` and `onManageAddresses`), the address-book editor, the test-send dialog and the no-op Publish button. There is no test send either, since a test send has effects outside the project. Edit workflows, templates and the config in your editor; Vite picks the change up and the studio refreshes.
- f9db1db: The studio reads schema-driven templates: registry entries made with `emailTemplate({...})` / `pushTemplate({...})` are listed by their `title` and `description`, and previewed from props validated with the SDK's own `parseTemplateProps` / `renderPushContent` — the parsed value is what the component or `content` receives, a push's notification comes from `content()` with no `{prop}` filling, and every email shows the project's `emails.from` / `replyTo`. A preview-props editor on the template page tries other props in memory only; the first load, every edit and every HMR change of a component, `content` or schema validate again, and a refusal shows the failing field paths instead of the last good render. Thumbnails in the workflow inspector use the same validated content. Template references are now kept per channel and key, so an email and a push sharing a key no longer merge usages, and template links carry `?channel=`. `TemplatesPage` takes `EmailTemplate` / `PushTemplate` registries and gains `selectedChannel`, `emailDefaults`, `previewProps`, `onPreviewPropsChange` and a structured `preview.failure`.
- f9db1db: Breaking: `workflow.stats.ts` runs on the studio's dev server (Node) instead of in the browser, so it can query the project's database or API with credentials from the environment. The page calls each defined `StatsSource` method over `POST /__studio/stats/<method>` (same-origin only, JSON in and out); a throwing method answers 500 with its message.

### Patch Changes

- f9db1db: Postgres stats count conversions by `converted_at` (falling back to status `goal` for older rows) and skip instances that never reached a node in the node counts; metric rows are keyed by template too, and a stats HMR update invalidates the cached queries.
- f9db1db: The studio's Vite server disables env files with `envDir: false` instead of the deprecated `envFile` option, so it no longer prints a deprecation warning on start.
- f9db1db: The Studio pre-bundles `@react-email/render` and `react-dom/server` and scans the project config for dependencies at startup, so the first email preview no longer fails with "Failed to fetch dynamically imported module" (Vite's outdated-optimize-dep 504) while Vite re-optimizes.
- f9db1db: Canvas labels for `reachable(...)` conditions and compound branch conditions, a Wait Until node titled with what it waits for, and a "latest device" note on pushes sent with `devices: 'latest'`.
- f9db1db: The Templates page lists every registered template, referenced by a workflow or not yet — the IR only adds where each is used — so a template can be previewed before a flow uses it; templates a workflow references without registering still show as missing. An unknown key in the URL says so instead of falling back to the first template, and the preview-props editor starts from the props the preview renders with. A registry can also be exported as one `{ email, push }` object (`export const registry = {...}` beside `t = templates(registry)`): the studio imports each channel as a property of that export, so a small project needs no per-channel index modules. The missing-registry hints name the `email` / `push` registries.
- f9db1db: Two Studio fixes: the preview-props editor no longer remounts (losing focus and caret) when the typed text first becomes valid JSON — its text is owned by the editor once edited and it is keyed by template only — and the project refreshes on changes to every file the last load actually evaluated (the config and its transitive imports in Vite's SSR graph, watched explicitly), so a `--config` outside the working directory or a shared module it imports no longer leaves the canvas on stale IR; the config's own workspace is also added to `server.fs.allow`.
- f9db1db: The Segments list names each segment by its label, else its id made readable (`used_api` → "Used api": underscores become spaces, the first letter is capitalized in CSS; no more "Untitled"), and its second line is the segment's description in the regular face — shown only when there is one — instead of the condition in monospace.

  The Segments page and the Home count list every deployed segment, whether a workflow uses it yet or not ("Not used by any workflow"), plus referenced ones that are not deployed; previously only segments a workflow referenced appeared. The Message Metrics table keys its rows by node and channel, so a push node reported for iOS and Android renders two rows without a duplicate-key warning.

- f9db1db: Postgres stats: one pool per connection string across dev-server reloads with a 20s idle timeout (it used to leak connections), opens and clicks only count for copies that reached the recipient, and day ranges follow local calendar days across DST changes.
- f9db1db: Studio fixes: a JSON error in the preview-props editor is dropped when switching templates, Discord/Slack previews only treat `_`, `*` and `~` as markers at word boundaries (so `snake_case` stays text), `schema --check` ignores formatter-only differences without collapsing real ones, and registry exports whose names are not identifiers are imported with quoted names.
- f9db1db: The templates list drops its ID column: each row shows the template's name, description and status, and the search still matches the key.
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
- Updated dependencies [f9db1db]
  - @shware/workflow@0.1.0
