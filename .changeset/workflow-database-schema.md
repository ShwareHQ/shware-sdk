---
'@shware/workflow': minor
---

Breaking: the Postgres store keeps its tables in a schema of its own, `workflow` unless `defineConfig({ database: { schema } })` names another, with short table names and no prefix (`tablePrefix` and `postgres-schema.sql` are gone). The tables are declared once in the SDK (`TABLES`): `renderDrizzleSchema(schema)` writes them as one drizzle file (`pgSchema(...)`, every table `workflowSchema.table(...)`, UUID v7 checks, timestamptz, no database defaults) for the host to migrate with its own drizzle-kit, and `renderPostgresDdl` as plain DDL. `journeyWorker`'s `store` callback receives the config's `{ schema }`, and `POST /bundle/deploy` first checks the live database against the declared tables (`PostgresJourneyStore.checkSchema`, read-only), answering 503 with every missing table or column instead of deploying.
