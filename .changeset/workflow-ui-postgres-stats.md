---
'@shware/workflow-ui': minor
---

`@shware/workflow-ui/postgres`: `postgresStats({ config, connectionString })`, a complete stats source over the reporting a journeyWorker on Postgres keeps (workflow overview, node counts, message metrics split into human and machine opens and clicks, links, segments and their members), read on the journey's clock in a fast-forwarded environment. `workflow-ui generate --out <file> [--check]` writes the engine's tables as one drizzle file on the config's database schema, and `--check` fails when the file is out of date.
