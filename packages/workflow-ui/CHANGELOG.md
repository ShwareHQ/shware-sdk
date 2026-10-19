# @shware/workflow-ui

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
