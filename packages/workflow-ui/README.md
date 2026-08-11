# @shware/workflow-ui

Review the workflows, email templates and reports of a `@shware/workflow`
project — from a local server, the way `react-email` previews emails.

```bash
npm i -D @shware/workflow-ui
npx workflow-ui
```

## workflow.config.ts

The CLI reads one config from your project root. Everything the studio shows is
listed there explicitly — no directory scanning, no naming conventions:

```ts
import { defineConfig } from '@shware/workflow-ui/config';
import { checkoutRecovery, winback } from './src/journeys';
import { emails } from './emails';

export default defineConfig({
  workflows: { checkoutRecovery, winback },
  emails,
  stats: {
    reports: () => fetch('/api/workflow-reports').then((r) => r.json()),
    nodeStats: (name) => fetch(`/api/workflow-stats/${name}`).then((r) => r.json()),
  },
});
```

`stats` is optional. Without it the canvas simply has no badges and the reports
view says no source is configured — the studio never passes mock data off as
real numbers.

## Views

- **Workflows** — the canvas rendered from compiled IR. Message cards link
  straight to their template.
- **Templates** — every template key referenced by your workflows, derived from
  IR rather than a hand-kept list, so "referenced but not written yet" is
  visible. Registered ones render through `@react-email/render`.
- **Reports** — per-workflow entered / active / completed / converted from your
  stats source.

## Options

```
-p, --port <port>    Port to listen on (default 4321)
-c, --config <path>  Config file (default ./workflow.config.ts)
    --open           Open the browser on start
```

## How it is built

- **TanStack Router** drives the studio, so every view is a shareable URL:
  `/workflows/$name`, `/templates/$key`, `/reports`. Routes are defined in code
  rather than by file convention — the studio ships inside a package, and a
  generated `routeTree.gen.ts` would have to be written into a consumer's
  `node_modules`.
- **TanStack Query** owns every read from your `stats` source and the email
  rendering, with `QueryCache.onError` wired to a toast: a failing stats call
  looks nothing like "no data configured".
- **sonner** for toasts, styled to match the canvas.

## Embedding

Routes fetch, components render — so the exported components carry no router
and no query client, and a host app can mount them directly:

```tsx
import { WorkflowCanvas, TemplatesPage, ReportsPage } from '@shware/workflow-ui';
```

The host keeps ownership of its own URL and data fetching.
