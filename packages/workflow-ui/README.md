# @shware/workflow-ui

Review the workflows, message templates and reports of a `@shware/workflow`
project — from a local server, the way `react-email` previews emails.

```bash
npm i -D @shware/workflow-ui
npx workflow-ui
```

## workflow.config.ts

The studio reads the project — the same `defineConfig({...})` object from
`@shware/workflow` that the compiler and the Worker read, so a workflow or a
template is listed once:

```ts
import { defineConfig } from '@shware/workflow';
import { templates } from './src/templates';
import { onboarding } from './src/workflows/onboarding';
import { contract } from './src/workflows/schema';

export default defineConfig({
  title: 'Workflow Studio · Acme',
  contract,
  workflows: [onboarding],
  templates,
  email: { unsubscribeUrl: 'https://acme.io/unsubscribe' },
});
```

```ts
// src/templates.ts — what the config registers; the workflows send email.welcome
import { email } from './email'; // export const email = { welcome, ... }
import { push } from './push'; // export const push = { nudge, ... }

export const templates = { email, push };
```

- The studio compiles it with `compileConfig` — the bundle the Worker
  deploys — so the lists are exactly what would ship. A config that does not
  compile (an unregistered or cross-channel template, a literal prop the
  template refuses) shows the compile error, naming the workflow and node,
  instead of the views. So does a default export that is not
  `defineConfig({...})`, and a registry entry that is not an
  `emailTemplate({...})` / `pushTemplate({...})`.
- `title` names the project in the browser tab. Each email template's own
  `from` / `replyTo` and its unsubscribe link (its `unsubscribeUrl`, else the
  config's `email.unsubscribeUrl`) are shown above its preview, and the
  preview renders inside the same `EmailProvider` a send does, so a layout's
  `useEmailContext()` works there too.
- Nothing is scanned: the workflows and registries are the ones registered.
  Adding or removing one updates the studio over HMR.
- The config is evaluated on the dev server, never in the browser. The
  browser receives the compiled IR as data and imports only the two template
  registries (the code a preview runs) from the modules that export them —
  so each registry has to be exported from a module of its own, not written
  inline in workflow.config.ts. A module exporting the registries as one
  `{ email, push }` object (with the email and push templates written in it)
  works too: each channel is imported as a property of that export.
- The Templates page lists every registered template, whether a workflow
  uses it yet or not; the IR adds where each one is used, and a template a
  workflow references without registering it shows as missing.
- Email and push are the channels with templates. Messages on other channels
  (Slack, Discord, …) appear on the canvas without a preview.

`--config` names a different file, and it is that file the studio loads.

### workflow.stats.ts

The numbers are the studio's own concern, not the project's: an optional
`workflow.stats.ts` (or `--stats <path>`) default-exports the source. It runs
on the studio's dev server, in Node — so it can query the project's database
or API directly, with credentials from the environment that the page never
sees. The page calls each method over HTTP (`POST /__studio/stats/<method>`),
so every answer must be JSON.

```ts
import { defineStats } from '@shware/workflow-ui/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

export default defineStats({
  reports: () => sql`select workflow as name, count(*)::int as entered … group by workflow`,
  nodeStats: async (name) => Object.fromEntries((await sql`…`).map((r) => [r.node_id, r.count])),
});
```

Every key is optional. Without a source the canvas has no badges and the
metrics view says none is configured; the studio never passes mock data off
as real numbers.

A journeyWorker on Postgres keeps the reporting itself, and
`@shware/workflow-ui/postgres` reads it: every view, human and machine opens
and clicks included, on the journey's clock when the environment runs in
fast-forward. `environment` names the `runtime` entry the database was written
under — `production` by default, so a production database is read at its real
pace; pass the fast-forwarded one (`development`) to read a local run.

```ts
import { postgresStats } from '@shware/workflow-ui/postgres';
import config from './workflow.config';

export default postgresStats({
  config,
  connectionString: process.env.STATS_DATABASE_URL!,
  environment: process.env.ENVIRONMENT ?? 'production',
});
```

The dev server serves the project's source to the page (Vite's `/@fs/`), except
`workflow.config.ts` and the stats file, which the page never imports, and the
credential files a project keeps beside its code (`.env*`, `.dev.vars*`, `*.p8`,
`*.plist`, `google-services.json`, `*.pfx`, `*.pem`, `*.key`). It sends no CORS
headers, so no other origin can read it. Still, keep credentials in environment
variables rather than literals.

## generate

`workflow-ui generate --out <file>` writes the engine's Postgres tables as one
drizzle file on the config's `database.schema` (`workflow` by default), for
your drizzle-kit to migrate. `--check` writes nothing and fails when the file
is out of date; formatting differences do not count.

## Read-only

The studio views your project; it never changes it. Edit workflows, templates
and `workflow.config.ts` in your editor — Vite picks the change up and the
canvas and previews refresh in place. There is no write-back, no publish
button and no test send: a test send has effects outside the project, so it
belongs in a command of its own.

## Views

- **Workflows** (`/workflows`, `/workflows/$name`) — the canvas rendered from
  compiled IR, and per-workflow metrics beside it. Message cards link straight
  to their template, and the inspector shows a node's parameters and the line
  that built it.
- **Templates** (`/templates`, `/templates/$key`) — every email and push
  template your workflows reference, derived from IR and found by id; an
  email and a push sharing an id stay two templates. Each renders
  from its `preview` props, validated against its schema exactly as a send
  would be; a props editor tries other values in memory, and a refusal lists
  the failing fields. Emails render through `@react-email/render`, pushes as
  iOS and Android notifications. Known difference: the
  studio renders with `@react-email/render`, while the Worker's
  `registryRenderer` uses react-dom's static markup, so whitespace and
  attribute order in the HTML can differ slightly — what the email says and
  how it is laid out does not. The template's from, reply-to, subject and
  unsubscribe link are shown above the preview.
- **Segments** (`/segments`, `/segments/$name`) — the discovered segments, with
  size and membership when `stats` provides them.
- **Settings** (`/settings`) — the config's `email`: the default unsubscribe
  link and the quick-click window.

## Options

```
-p, --port <port>    Port to listen on (default 4321)
-c, --config <path>  Project file (default ./workflow.config.ts)
-s, --stats <path>   Stats source (default ./workflow.stats.ts, if present)
    --open           Open the browser on start

generate
-o, --out <file>     Where the drizzle schema file goes
    --check          Fail when the file is out of date, write nothing
```

## How it is built

- **TanStack Router** drives the studio, so every view is a shareable URL.
  Routes are defined in code rather than by file convention — the studio ships
  inside a package, and a generated `routeTree.gen.ts` would have to be written
  into a consumer's `node_modules`.
- **TanStack Query** owns every read from your `stats` source and the email
  rendering, with `QueryCache.onError` wired to a toast: a failing stats call
  looks nothing like "no data configured".
- **sonner** for toasts, styled to match the canvas.
- The one dev-server endpoint (`GET /__studio/node`, which maps a node back to
  its line on disk) only answers same-origin requests: it reads your source, so
  a page you merely visit must not be able to reach it. Everything else under
  `/__studio` answers 404.

## Embedding

Routes fetch, components render — so the exported components carry no router
and no query client, and a host app can mount them directly:

```tsx
import { WorkflowCanvas, TemplatesPage, WorkflowList, MetricCard } from '@shware/workflow-ui';
```

The host keeps ownership of its own URL and data fetching.
