---
'@shware/workflow': minor
---

`@shware/workflow/node`: the journey host as a Node process on Postgres, with no other service.

- **`journeyNode({ config, sql, vars, version })`** runs the engine where Node and Postgres run. The process is the runtime: an instance is a row (`run`), its checkpoints are rows (`run_step`), and workers take due runs a turn at a time — replaying the journey from the top and answering finished steps from their checkpoints, the model Cloudflare Workflows and Lambda durable functions run it on. `start({ port })` serves the HTTP API, runs the workers and the sweep; `fetch(request)` and `drain()` run the same thing in-process for tests, over PGlite if you like.
- Any number of processes: a run is claimed with `FOR UPDATE SKIP LOCKED`, every write of a turn is fenced by the claim (a worker that stalled past its lease cannot write over its successor), and one process runs each sweep. A wake that lands while a turn is deciding to park is not lost: the park is conditional on the wake counter.
- Defaults follow Cloudflare Workflows: a step is retried 5 times (10 seconds, doubling) and an attempt may take 10 minutes; a process takes 10 runs at once; a run that ended is kept 7 days. Steps are at least once, as on the other runtimes.
- **Migration required, on every runtime:** two new tables, `run` and `run_step` — regenerate the drizzle file (`workflow-ui generate`) and run the migration; `POST /bundle/deploy` answers 503 without them. They stay empty on Cloudflare and AWS.
- New. The claim, a wake racing a park, and a process killed mid-step are tested on a real Postgres over several connections and processes; a pool that defaults to REPEATABLE READ is handled. Measured on a 2 vCPU Postgres at about 300 runs (1,000 actions) a second, flat from no users to a million, with the database as the limit; with actions that take time the limit is `concurrency`, whose default of 10 is low for sends. No `LISTEN`/`NOTIFY` (a worker in another process finds a run at its next poll, a second by default), and no conformance suite across the three hosts yet. `docs/decisions/self-hosted-host.md` has the design and the list.
