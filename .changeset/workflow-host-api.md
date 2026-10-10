---
'@shware/workflow': minor
---

A host is now one call: `journeyWorker(options)` (`@shware/workflow/cloudflare`) returns the runner class and the fetch handler with the store lease lifecycle, `/bundle` + `/bundle/deploy`, `/preview/*` and bearer auth built in. `CfEmailSender` takes an options object (`binding`, `from` / `replyTo` with display names, `render`, `profile` as a store or lookup). New subpaths: `@shware/workflow/postgres-js` (`postgresJsStore`, `postgresJsClient`; `postgres` optional peer), `@shware/workflow/react-email` (`registryRenderer` over the email registry; `react-dom` optional peer) and `@shware/workflow/client` (`JourneyClient` with `identify` / `track` (optional `{ id, ts }` for idempotent retries) / `deploy` for producers such as an api server).
