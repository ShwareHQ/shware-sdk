---
'@shware/workflow': major
---

Postgres is the engine's one store. The D1 store, its `schema.sql`, the `DB` binding and the `WORKFLOW_KV` namespace are gone: `journeyWorker` and `journeyLambda` take a required `store` (`postgresJsStore` over Hyperdrive on Cloudflare), `handleRequest` and the ingest functions take the store as a parameter, and `JourneyStore`'s reporting, execution registry, suppressions, schema check and live-version members are required rather than optional — nothing degrades silently any more. `UnversionedStoreError` no longer exists. The Cloudflare demo runs on a docker Postgres (`pnpm db:up`, `pnpm dev`).
