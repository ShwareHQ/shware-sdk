# @shware/workflow-ui

Review the workflows, message templates and reports of a `@shware/workflow`
project — from a local server, the way `react-email` previews emails.

```bash
npm i -D @shware/workflow-ui
npx workflow-ui
```

## Conventions

Definitions are not listed anywhere: the CLI finds them by location, the way
next.js finds pages. Nothing is scanned outside these paths.

| Path                                         | What is picked up                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `src/workflows/` (or `workflows/`)           | every module in the tree; exports that are workflows or segments show up |
| `src/emails/index.ts` (or `emails/`)         | `export const emails` — the email registry                               |
| `src/pushes/index.ts` (or `pushes/`)         | `export const pushes` — the push registry                                |
| `src/slack/index.ts`, `src/discord/index.ts` | `export const slack` / `export const discord` — the chat registries      |

A workflow is keyed by its export name, and that name is its identity — the
studio URL, the reports row, the key in IR. Two modules exporting the same name
(two files that both `export default workflow(…)` are both named `default`)
raises an error naming both files instead of one of them quietly winning.

The registries stay explicit objects because they are what types
`templates<Emails>()` keys at compile time.

## workflow.config.ts

The config is optional, and carries only what conventions cannot: project
settings and runtime wiring.

```ts
import { defineConfig } from '@shware/workflow-ui/config';

export default defineConfig({
  title: 'Acme',
  emails: {
    addresses: ['Acme <hello@acme.io>'],
    sendTest: ({ to, subject, html }) =>
      resend.emails.send({ from: 'Acme <hello@acme.io>', to, subject, html }),
  },
  stats: {
    reports: () => fetch('/api/workflow-reports').then((r) => r.json()),
    nodeStats: (name) => fetch(`/api/workflow-stats/${name}`).then((r) => r.json()),
  },
});
```

- `title` — names the project in the browser tab, which matters with several
  studios open at once.
- `emails.addresses` — the sender identities the from / reply-to pickers offer.
  "Add address" in Settings writes back into this array.
- `emails.sendTest` — delivers a rendered template to a real inbox. Transport is
  the project's business, so it stays a hook; the "send test" button only
  appears when it is set.
- `stats` — every read behind the numbers, each key optional. Without it the
  canvas has no badges and the metrics view says no source is configured; the
  studio never passes mock data off as real numbers.

`--config` names a different file, and it is that file the studio loads and
writes addresses back into.

## Views

- **Workflows** (`/workflows`, `/workflows/$name`) — the canvas rendered from
  compiled IR, and per-workflow metrics beside it. Message cards link straight
  to their template, and editing a node's name or a literal in the inspector
  patches the definition in your source file.
- **Templates** (`/templates`, `/templates/$key`) — every template key
  referenced by your workflows, derived from IR rather than a hand-kept list, so
  "referenced but not written yet" is visible. Registered emails render through
  `@react-email/render`; pushes and chat messages render as their own previews.
  Envelope fields (subject, from, reply-to, name, description) are editable and
  land back in the template module.
- **Segments** (`/segments`, `/segments/$name`) — the discovered segments, with
  size and membership when `stats` provides them.
- **Settings** (`/settings`) — the sender address book.

## Options

```
-p, --port <port>    Port to listen on (default 4321)
-c, --config <path>  Config file (default ./workflow.config.ts)
    --open           Open the browser on start
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
- The write-back endpoints only answer same-origin requests. They edit files on
  your disk, so a page you merely visit must not be able to reach them.

## Embedding

Routes fetch, components render — so the exported components carry no router
and no query client, and a host app can mount them directly:

```tsx
import { WorkflowCanvas, TemplatesPage, WorkflowList, MetricCard } from '@shware/workflow-ui';
```

The host keeps ownership of its own URL and data fetching.
