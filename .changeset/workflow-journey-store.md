---
'@shware/workflow': minor
---

Storage behind a `JourneyStore` port: the ingest router, runner and fact source no longer touch D1/KV directly. `D1JourneyStore` keeps the original D1 + KV data plane (the default when `DB` and `WORKFLOW_KV` are bound), and the new `PostgresJourneyStore` (`@shware/workflow/store`, reference DDL in `postgres-schema.sql`) runs the same contract on Postgres through a minimal `SqlClientLike` (parameterized `query` + `transaction`), so a host can keep Cloudflare Workflows for execution and Postgres for data. `JourneyRunner` gains `createStore` / `closeStore` hooks, the router functions take an optional store, `/identify` is exposed as `identifyUser`, and `D1FactSource` is replaced by the store-backed `JourneyFactSource`.
