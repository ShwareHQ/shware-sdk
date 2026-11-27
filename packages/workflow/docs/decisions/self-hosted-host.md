# A self-hosted host: Node and Postgres

Status: **built, first version** (2026-11-27), as `@shware/workflow/node`. What follows is the
design it was built from; "Decided" and "What the first version is and is not" at the end say
where it stands and where it departs from the design.

## Why

The engine runs in two places today, Cloudflare Workflows and AWS Lambda durable functions. A
third host that needs only a Node process and the Postgres the engine already uses would:

- let anyone deploy it wherever Node and Postgres run (a VPS, Fly, Railway, Kubernetes), with no
  cloud account;
- run whole journeys in-process for tests and for the Studio, on PGlite, with no `wrangler` and
  no fake of a platform;
- keep the other two hosts honest: three implementations of one port show what the port really
  promises.

## What this is, and what it is not

It is a third **host**, beside `src/cloudflare` and `src/aws`. The interpreter, the store, the
entry ledger, segments, reporting, the HTTP API and the sweep are already platform-free and are
not touched.

It is **not** a general durable-execution platform. It runs one program, our interpreter, for one
tenant. That is why it is small; see "Is it really that simple?" below.

## What a host has to supply

Two ports, both already defined and already implemented twice.

**`EngineStep`** (`src/engine/ports.ts`), what a running journey asks of its runtime:

| Call                                | Promise                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `do(name, fn)`                      | Run `fn`, remember its result under `name`; on replay return the remembered result            |
| `sleep(name, ms)`                   | Resume no earlier than `ms` from the first time this was reached                              |
| `subscribe` / `unsubscribe`         | Durable writes to the `subscription` table (the same rows Cloudflare uses)                    |
| `waitForWake(name, { deadlineMs })` | Park until a wake arrives or the deadline passes; answer `'event'` or `'timeout'`, remembered |

The port's contract is deliberately weak, which is what makes a third implementation cheap: a
wake is **a hint, at least once** (the interpreter re-reads the condition after every wake), and
every source of non-determinism already happens inside `do`.

**`WorkflowBindingLike`** (`src/host/platform.ts`), what the rest of the host asks of the runtime:
`create({ id, params })`, `get(id)` answering `InstanceNotFoundError` for an unknown id, and on
an instance `sendEvent`, `status`, `terminate`. The optional `plan` / `resume` / `maintain` exist
for AWS, whose start is a submit that can be lost; here a start is an `INSERT` in the same
database as the entry, so they are not needed.

For scale: the Cloudflare host is about 600 lines, the AWS host about 1,100.

## Design

### One process, one database

```
          HTTP (ingest, tracking, deploy)        timers
                    │                              │
   ┌────────────────▼──────────────────────────────▼───────────────┐
   │  node process:  http server · run workers · sweep scheduler    │
   └────────────────┬───────────────────────────────────────────────┘
                    │  SQL, LISTEN/NOTIFY
               ┌────▼─────┐
               │ Postgres │  engine tables  +  run, run_step
               └──────────┘
```

Every process is the same and does all three jobs. Running two or more is how it is made
available; nothing is elected except the sweep (below).

### Tables

Two, in the engine's schema, declared in `store/tables.ts` like the rest.

**`run`**, one row per instance:

| Column                       | Meaning                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `instance_id` (pk)           | The id the host builds, as on the other runtimes                                       |
| `params`, `entered_at`       | What `create` was given; the trigger's time                                            |
| `status`                     | `queued`, `running`, `sleeping`, `waiting`, `complete`, `errored`, `terminated`        |
| `wake_at`                    | When a worker may next pick it up: now, a sleep's end, a wait's deadline               |
| `signals`                    | A counter `sendEvent` increments; a wait remembers the value it saw                    |
| `lease_owner`, `lease_until` | Which process is running it, and until when that claim holds                           |
| `lease_gen`                  | Incremented on every claim: the fencing token every write of a turn is checked against |
| `error`, `finished_at`       | How it ended                                                                           |

**`run_step`**, one row per checkpoint, keyed `(instance_id, name)`: the `kind` (`do`, `sleep`,
`wait`), the JSON `result` (a step's return value, a sleep's wake instant, a wait's verdict), and
for a failing step its `attempts` and next retry time.

### A turn

Execution is replay, the same model as both existing hosts.

1. **Claim.** One statement: pick a row with `wake_at <= now()` whose lease is free or expired,
   `FOR UPDATE SKIP LOCKED`, set the lease and increment `lease_gen`.
2. **Load** the instance's `run_step` rows into memory.
3. **Run** `executeJourney` from the top with a `NodeEngineStep`. A call whose checkpoint exists
   returns it at once; the first call without one does the real work.
4. **End the turn** in one of three ways: the journey returns (`complete`), it throws
   (`errored`, and the failure path in `execute.ts` settles the ledger as it does today), or it
   **suspends**: a sleep or a wait writes its checkpoint, sets `status` and `wake_at`, releases
   the lease, and the turn stops.

A step's side effect and its checkpoint are two writes, so a crash between them runs the step
again: **steps are at least once**, exactly as on Cloudflare and AWS. The engine already assumes
it (the message claim, the event id, the entry occurrence are what make a repeat harmless).

### The five primitives

- **`do`**: no checkpoint → run `fn`, insert the result. On a throw: a non-retryable error
  (`isRetryable`, the rule the other hosts use) ends the step now; otherwise record the attempt,
  set `wake_at` to a backoff, suspend. After the last attempt the error reaches the interpreter.
- **`sleep`**: first reach → insert the wake instant, suspend until it. On replay: past it,
  return; not yet (woken early by something else), suspend again until the same instant.
- **`subscribe` / `unsubscribe`**: `do` around the store's `subscribe` / `unsubscribe`.
- **`waitForWake`**: checkpoint exists → return it. Else, if `run.signals` has moved since the
  wait began → checkpoint `'event'`; if `deadlineMs` has passed → checkpoint `'timeout'`; else
  suspend with `wake_at = deadlineMs`.
- **`sendEvent`** (the binding): `UPDATE run SET signals = signals + 1, wake_at = now()` and a
  `NOTIFY`.

The one race that matters is a wake landing while a turn is deciding to park. The park is
therefore conditional, `... WHERE instance_id = $1 AND signals = $seen`: if the counter moved,
nothing is parked and the instance is picked up again at once. A spurious wake is harmless by the
port's contract; a lost one would cost a whole timeout.

Unlike Cloudflare, a timeout here is an answer, not a thrown error, so the `wakeExpired` guess in
`cloudflare/runner.ts` has no counterpart.

### How a turn stops in the middle

The interpreter awaits `step.sleep(...)`; the host has to stop there without running what
follows. Two ways:

- **A promise that never settles**, with the turn's driver racing it against a "suspended" signal
  (what the AWS durable SDK does). Nothing is thrown through the interpreter.
- **A thrown sentinel** caught by the driver. Simpler, but any `catch` or `finally` in the
  interpreter sees it and must let it through.

Proposed: the first. The interpreter has `try`/`catch` around sends and guards, and a sentinel
swallowed by one of them would silently skip a sleep. Its cost is that no `finally` between the
suspension and the driver runs, so nothing in that range may hold a resource; today nothing does
(the store lease is the driver's).

### Leases

A worker extends `lease_until` while it runs a turn. One that dies leaves a lease that expires,
and another worker claims the row with a higher `lease_gen`. Every write of a turn (checkpoints,
the suspension, the end) carries `WHERE lease_gen = $mine`: a worker that was only slow, not dead,
finds its writes refused and drops the turn. This is the part to get exactly right; it is also
standard, and small.

### Picking work up

`LISTEN` on one dedicated connection wakes idle workers immediately (a `create`, a `sendEvent`);
a poll every second or so is the fallback and the only mechanism behind a pooler in transaction
mode, where `LISTEN` does not work. Timers need no scheduler: a due sleep is just a row whose
`wake_at` has passed. An index on `(wake_at) WHERE status IN (...)` keeps the claim cheap.

### The rest of the host

- **HTTP**: `handleRequest` already takes a `Request` and answers a `Response`; `node:http` in
  front of it, about thirty lines, as `aws/function-url.ts` does for Lambda.
- **Sweep**: an interval timer in every process, with a Postgres advisory lock so one of them
  runs it. No time budget is needed (`DATE_FANOUT_BUDGET_MS` is a Cloudflare concern).
- **Bundle version**: there is no version-metadata binding, so the process is told its version
  (a build id and build time, from the environment) and `applyOwnBundle` works as it does now.
- **Shutdown**: on `SIGTERM` stop claiming, let running turns reach their next checkpoint,
  release leases. A turn that does not finish in time is recovered by lease expiry.
- **Erasure**: `terminate` sets `status = 'terminated'`; a turn in flight loses its next write
  to the status check.
- **Retention**: finished runs and their steps are deleted after a period (Cloudflare keeps them
  7 days), by the sweep's maintenance.

### Dependencies

Node's standard library, and the Postgres client the package already takes as an optional peer
(`postgres`). `LISTEN` uses that client's own support. Nothing else: no queue, no Redis, no
framework.

### Local development and tests

The same host over PGlite, in one process: `create` a journey and drive turns by hand, with the
clock injected. That gives tests a real runtime with no fake, and gives the Studio a way to run a
journey end to end. PGlite is one connection, so the host must not need a second (the `LISTEN`
connection is optional, and polling is always there).

## Is it really that simple?

The core is, and that is not a trick. Durable execution rests on one idea: **record what each
step returned, and on restart run the same code again, answering from the record**. Everything
above is that idea plus a table of timers. Several open-source libraries are this, in a few
thousand lines, on Postgres.

What makes Cloudflare Workflows and Lambda durable functions hard to build is mostly not that
idea:

| What the products have to solve                                                     | Here                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Arbitrary customer code, which must be deterministic on replay and usually is not   | One program, ours: every non-deterministic act is already inside a step |
| Thousands of tenants isolated from each other, metered and billed                   | One tenant                                                              |
| Capacity nobody has to provision, sleeping instances that cost nothing              | A process you run and pay for while it idles                            |
| Code versions: an execution started on version 3 resuming while version 5 is live   | The IR is pinned by hash; the interpreter is the only code              |
| A rich API: child workflows, queries, signals with payloads and ordering, schedules | Five calls, and a wake that is only a hint                              |
| Operating it: regions, failover, upgrades, dashboards, quotas                       | Yours to run                                                            |

So this does not reproduce those products. It reproduces the slice of them this engine uses, and
hands the operating to whoever deploys it.

What is genuinely hard in that slice, and where the bugs will be:

- **Leases and fencing.** Two workers on one instance must not both write. Easy to state, easy to
  get subtly wrong under a paused process or a slow network.
- **The lost wake** described above, and its twin: a wake arriving between `subscribe` and the
  first `waitForWake`.
- **A crash between a side effect and its checkpoint.** Not preventable; what matters is that
  every step's repeat is harmless, which is the engine's property, not the host's — but a third
  host will exercise it in new ways.
- **Retries that survive a restart**: attempt counts and backoff live in the table, not in
  memory.
- **Postgres as a queue**: hot rows updated often. Fine at this scale with autovacuum doing its
  job, a real limit far beyond it.

The review of this package found most of its defects at exactly these host boundaries. Expect
the same here.

## What it costs

- An estimated 800 to 1,200 lines of source, and at least as many of tests.
- A third host to keep in step. This is the larger cost, and the reason for the next section.

## A conformance suite, built with it

One set of scenarios run against every host: a step retried, a permanent failure, a sleep, a wait
woken, a wait timing out, a wake during a turn, a worker dying mid-turn, a terminate, the same id
created twice. The workerd suite (`tests/workerd`) is the start of it for Cloudflare, and
`LocalDurableTestRunner` covers AWS; the scenarios should be written once and each host should
supply only its driver. Without this, the third host raises the cost of every change to the port.

## Decided

The six questions the design left open, settled 2026-11-27 by following Cloudflare Workflows
where it has an answer.

1. **Step retries**: 5 retries after the first attempt, 10 seconds before the first, doubled
   each time, and an attempt that runs longer than 10 minutes counts as failed. These are
   Cloudflare's step defaults as remembered, not re-read from its documentation. Configurable
   (`retry`).
2. **Concurrency**: 10 runs at once per process. A lease is 60 seconds and a running turn keeps
   extending it, so a slow action is bounded by the step timeout, not by the lease.
3. **Retention**: a run that ended is removed after 7 days, by the sweep. Configurable.
4. **`wrangler dev` stays.** The Node host sits beside it; nothing in the template's scripts
   changes.
5. **Step identity**: the name and its occurrence in the run (`n3:send`, then `n3:send#2`), as
   Cloudflare counts a repeated name. The interpreter's names look unique today, and the key does
   not depend on it.
6. **It ships as `@shware/workflow/node`**: `journeyNode(options)` with `start()` / `stop()`, and
   no CLI.

## What the first version is and is not

Built, and covered by `tests/node-host.test.ts` on PGlite with a faked clock (and, for what
PGlite's one connection cannot show, on a real Postgres: see the end):

- `run` / `run_step`, the claim with `FOR UPDATE SKIP LOCKED`, the fence on every write.
- All five primitives, retries with a backoff kept in the table, the step timeout.
- A turn stopped by a promise nothing settles, as designed; steps running beside the one that
  stopped it are let finish before the run is released.
- The runtime port (`create`, `get`, `sendEvent`, `status`, `terminate`), `node:http`, worker
  loops, the sweep timer, retention, erasure.

Where it departs from the design above:

- **The wait's baseline is taken at `subscribe`, not at the wait.** The interpreter subscribes,
  checks its condition, then waits; a wake between the subscribe and the wait has to count. The
  `subscribe` step reads the counter before it writes the registration and keeps the value as
  its checkpoint.
- **No `LISTEN` / `NOTIFY`.** Within a process, a `create` or a wake rouses an idle worker
  directly; across processes a worker finds the run at its next poll (1 second by default). It
  keeps the client down to the two-method `SqlClientLike`, and works behind any pooler. Adding
  it would cut that second.
- **The sweep's turn is a row, not an advisory lock.** One row in `deployment` (`scope` =
  `'sweep'`) is claimed by whichever process moves its time forward; nothing is held while the
  sweep runs. An advisory lock needs a connection held for the length of the sweep, which a
  single-connection database (PGlite) cannot give.
- **A sweep that ran out of its budget carries on at once.** The sweep stops after about 30
  seconds on the segments (or on a date trigger's users) and keeps its place in the store, for
  hosts whose invocation has a limit. A process has none, so the one whose turn it is calls it
  again until the pass ends — for no longer than one interval, and not while a round gets
  nowhere; what is left is the next turn's.
- **Shutdown is plain**: `stop()` ends the loops and waits for the turns in flight.

Not built:

- **The conformance suite.** The Node host has its own tests; nothing yet runs one set of
  scenarios against all three hosts. Until it does, a change to the port is checked three times
  by hand.
- An index tuned for the claim (`wake_at` is indexed plainly). Throughput is measured at the end
  of this document; nothing there calls for the index yet.

## On a real Postgres (2026-11-27)

`tests/integration/node-host.test.ts` runs the host against a server (Postgres 17, local), over
separate connections and then separate processes. It ran clean eight times in a row; each case
was also run against the fault it is for, and failed.

- **The claim**: 16 connections taking 400 runs at once. Every run is handed out, and to one
  worker. Without `FOR UPDATE SKIP LOCKED` the same runs are handed out several times over.
- **A wake against a park**: 300 runs, the park and the wake sent together on different
  connections. Both orders occur (roughly 180 parked first, 120 woken first), and in both the
  run is due at once. With a park that ignores the counter, the woken-first runs sleep to their
  deadline.
- **Four hosts, each on its own pool**: 200 journeys, each one's event sent the moment its wait
  began — all 200 while the turn was still running. Every run completes, every action ran
  exactly once, and one of the four hosts took the sweep.
- **Three processes of the built package, over HTTP, one killed with SIGKILL mid-step**: all
  150 runs complete on the other two. The steps the dead process had run but not checkpointed
  ran again — 4 of them, its concurrency — and nothing else did: at least once, as stated.

What it found:

- **A pool that defaults to REPEATABLE READ broke the claim** (`could not serialize access due
  to concurrent update`). Every contended statement of the runtime now runs again, on that
  error, in a transaction pinned to READ COMMITTED. Under the server's default nothing changes
  and nothing is paid.
- **A claim can come back empty while runs are due**: when the run it reached for was taken in
  the same instant, the statement returns nothing rather than the next one (a handful of times
  in 400 claims under sixteen workers). The worker looks again at its next poll; nothing is
  lost, and the delay is at most the poll interval.

## Throughput (2026-11-27)

Measured by `bench/node-host.mjs`, on one machine's Docker (an M1 Max; nothing leaves it):

- **Postgres 17**: one container, 2 vCPU, 4 GB, `shared_buffers` 1 GB, otherwise defaults.
- **The host**: the built package on `node:26-slim`, each container 1 vCPU, 1 GB.
- **The user base**: every user has a profile, an event and one journey asleep until tomorrow
  (an entry, an instance, a run and its checkpoints). Sizes are users, before the batches.
- **The journeys' actions do nothing** unless a time is given: these are the engine's own cost.

Read them as the shape of the thing on small instances, not as a capacity plan: one run of each
cell, local disks, and a network of no distance between the host and its database.

**Where it stands now** (2026-11-28, after the two changes at the end of this document; the
tables in between are the first measurement and are kept as the baseline):

| 2 hosts × 1 vCPU, 10 runs at once each, 2 vCPU Postgres | First measurement | Now      |
| ------------------------------------------------------- | ----------------- | -------- |
| Runs/s, a batch of three-action journeys, 100k users    | 343               | 461      |
| The same at 1M users                                    | 342               | 446      |
| Runs/s to parked, a journey with a wait, 100k users     | 269               | 295      |
| Runs/s woken to end, 100k users                         | 295               | 324      |
| Statements a run                                        | 47                | 37       |
| Transactions a run                                      | 21                | 13       |
| WAL a run                                               | 6.9 kB            | 5.9 kB   |
| Engine schema on disk, 1M users asleep                  | 3,518 MB          | 2,336 MB |

The database is the limit throughout, at both its cores.

### A batch already queued: three actions, one turn

| Users | Hosts      | Runs at once, each | Runs/s | Transactions/run | Postgres CPU | Host CPU |
| ----- | ---------- | ------------------ | ------ | ---------------- | ------------ | -------- |
| 0     | 2 × 1 vCPU | 10                 | 307    | 21.2             | 204%         | 56%      |
| 10k   | 2 × 1 vCPU | 10                 | 337    | 21.2             | 203%         | 54%      |
| 100k  | 2 × 1 vCPU | 10                 | 343    | 21.5             | 204%         | 57%      |
| 1M    | 2 × 1 vCPU | 10                 | 342    | 21.2             | 201%         | 61%      |
| 100k  | 1 × 1 vCPU | 10                 | 356    | 21.5             | 202%         | 94%      |
| 100k  | 4 × 1 vCPU | 10                 | 329    | 21.3             | 209%         | 33%      |
| 100k  | 2 × 1 vCPU | 50                 | 308    | 21.2             | 204%         | 52%      |

10,000 runs a cell. CPU is one sample mid-run; 100% is one core.

- **The size of the user base does not show.** From none to a million users asleep, the rate
  is the same within the noise of one run. The claim reads the head of an index.
- **The database is the limit, at both its cores, in every cell.** One 1 vCPU host is enough to
  saturate a 2 vCPU Postgres; more hosts, or more runs at once, add nothing.
- About 310–350 runs a second, 1,000 actions a second — near 28 million runs a day — from the
  smallest database one would deploy.

### In service: an action, a wait for an event, an action

Events arrive over HTTP at the running hosts, forty requests at a time; each journey parks on
its wait and is woken by a second event. 5,000 journeys a cell.

| Users | Hosts      | Events/s accepted | Runs/s to parked | Wakes/s accepted | Runs/s woken to end | Postgres CPU | Host CPU |
| ----- | ---------- | ----------------- | ---------------- | ---------------- | ------------------- | ------------ | -------- |
| 0     | 2 × 1 vCPU | 601               | 230              | 807              | 260                 | 204%         | 57%      |
| 10k   | 2 × 1 vCPU | 651               | 250              | 781              | 291                 | 204%         | 56%      |
| 100k  | 2 × 1 vCPU | 669               | 269              | 890              | 295                 | 214%         | 54%      |
| 100k  | 4 × 1 vCPU | 471               | 235              | 703              | 290                 | 200%         | 31%      |
| 1M    | 2 × 1 vCPU | 672               | 253              | 898              | 173                 | 192%         | 34%      |

The same limit. The one figure out of line is the last column at a million users (173): not
explained, and not repeated to see whether it holds. By then the schema is 3.5 GB on a 4 GB
container, so the events read to check each wait may no longer have been in memory.

| Users | Rows in `run` | Engine schema on disk |
| ----- | ------------- | --------------------- |
| 0     | 1             | 848 kB                |
| 10k   | 25,001        | 114 MB                |
| 100k  | 130,001       | 474 MB                |
| 1M    | 1,080,001     | 3,518 MB              |

(The rows beyond the user base are the batches measured before it.)

### When an action takes time

A send is a call to a provider. Two hosts, 100k users, three actions a journey, each action
taking the time given. "The setting allows" is hosts × runs at once ÷ the journey's three
actions' time.

| Action takes | Runs at once, each host | Runs/s | Actions/s | Runs/s the setting allows | Postgres CPU | Host CPU |
| ------------ | ----------------------- | ------ | --------- | ------------------------- | ------------ | -------- |
| 200 ms       | 10                      | 31.4   | 94        | 33.3                      | 18%          | 7%       |
| 200 ms       | 50                      | 159    | 478       | 167                       | 91%          | 23%      |
| 200 ms       | 200                     | 330    | 989       | 667                       | 204%         | 61%      |
| 1 s          | 10                      | 7.0    | 21        | 6.7                       | 2%           | 1%       |
| 1 s          | 50                      | 35.0   | 105       | 33.3                      | 10%          | 2%       |
| 1 s          | 200                     | 138    | 415       | 133                       | 36%          | 23%      |

- **With real actions the limit is `concurrency`, not the database.** A turn holds one of the
  host's places for as long as its action runs, so a host does `concurrency ÷ action time`
  actions a second and no more. The measured rates sit on that line until the database's own
  limit is reached (200 ms at 200).
- **The default of 10 is low for sends.** It is Cloudflare's figure, taken over. At one second
  a send, two hosts at the default finish 7 runs a second with everything idle; at 200 they
  finish 138, on a quarter of a core. Waiting on a provider costs a host almost nothing, and a
  connection is held for a query, not for the action: a pool of 40 served 200 runs at once.
- So: set `concurrency` from the provider's latency and rate limit, and expect the database to
  matter only past a few hundred runs a second.

### Where the database's time goes

One batch of 10,000 three-action runs under `pg_stat_statements` (two hosts, 100k users):
**47 statements, 21 transactions, 6.9 kB of WAL and 1.1 ms of statement execution a run.**

| Share of execution time | Calls/run | Mean ms   | Statement                                            |
| ----------------------- | --------- | --------- | ---------------------------------------------------- |
| 46%                     | 9         | 0.059     | the checkpoint (`INSERT INTO run_step`)              |
| 22%                     | 5         | 0.03–0.08 | the instance's reporting row (three forms of upsert) |
| 9%                      | 1         | 0.103     | the claim                                            |
| 9%                      | 2         | 0.03–0.07 | the entry (admitted, then its final status)          |
| 4%                      | 1         | 0.044     | the run's end                                        |
| 2%                      | 1         | 0.024     | reading the run's checkpoints                        |
| 3%                      | 12        | 0.003     | `SET TRANSACTION`, the user's advisory lock          |

- **It is not a slow query, and not the claim.** The claim is a tenth of a millisecond and 9% of
  the execution time; no statement is slow. An index would not move these figures.
- **It is the number of statements.** Execution is 1.1 ms a run, about 11 core-seconds of the
  roughly 58 the database spent on the batch: four fifths of its CPU went on what surrounds a
  statement — receiving it, parsing and planning it, committing, answering — 47 times a run.
- Nine checkpoints for three actions: besides each action, the interpreter checkpoints its own
  bookkeeping (the entry started, each node reached, the workflow's definition), and each is
  its own round trip and its own commit.

What would raise the limit, in the order of what it is likely to return — none of it done, and
the returns are estimates until measured:

1. **Fewer round trips a run.** Write a turn's checkpoints together; read the run's checkpoints
   in the claim; end the run with its last checkpoint; claim several runs in one statement.
   Something like 21 transactions to 8–10. **The first three are done — see below.**
2. **Prepared statements.** The host sends every statement as text, planned anew each time;
   whether the client can prepare them, and what it returns, has not been tried.
3. **Not storing the workflow's definition in every run's checkpoints** (`$workflow:ir`; **done — see the end**): it is
   most of the 3.5 GB above, and of the WAL. The definition is in `ir`, under its hash.
4. **A partial index for the claim and room for HOT updates on `run`**: for bloat over months,
   not for the rate. Nothing here shows a need yet.
5. More cores on the database. This load should follow them; that too is unmeasured.

### After the first cut in round trips (2026-11-28)

Three changes, the tables above being from before them:

- **The engine marks its own bookkeeping steps** (`StepOptions.idempotent`: the stored
  definition, the entry started, a node reached, the ending). The runtime holds their
  checkpoints and writes them with the next step's that cannot wait — an action, a decision —
  in one statement. Nothing whose result picks a branch or reaches outside the store is held.
  If the process dies in between, the bookkeeping runs again, as it could before.
- **The statement that ends a turn carries the checkpoints still held**: the run's end with
  its last one, a suspension with the sleep's instant or the retry's backoff.
- **The claim returns the run's checkpoints**, instead of a second round trip to read them.

The same machine and sizes, 100k users, one run of each cell:

| Hosts      | Runs at once, each | Runs/s before | Runs/s after | Change |
| ---------- | ------------------ | ------------- | ------------ | ------ |
| 2 × 1 vCPU | 10                 | 343           | 434          | +27%   |
| 1 × 1 vCPU | 10                 | 356           | 406          | +14%   |
| 4 × 1 vCPU | 10                 | 329           | 425          | +29%   |
| 2 × 1 vCPU | 50                 | 308           | 377          | +22%   |

| A run of three actions | Before | After                     |
| ---------------------- | ------ | ------------------------- |
| Statements             | 47     | 38                        |
| Transactions           | 21     | 14                        |
| Writes of checkpoints  | 9      | 3 (+1 with the run's end) |
| Statement execution    | 1.1 ms | 1.3 ms                    |
| WAL                    | 6.9 kB | 9.5 kB                    |

- The database is still the limit, at both cores, in every cell.
- **The journey with a wait did not move** (parked 269 → 266 runs/s, woken to end 295 → 280:
  noise). Its steps are the wait's own checks, which are decisions and are not held.
- **The WAL went up, and that is not explained.** The same rows are written in fewer
  statements; more bytes were not expected. Not looked into.
- What is left is mostly not the runtime's: of the 38 statements, 24 are six transactions of
  the store's own (`BEGIN`, `SET TRANSACTION`, the user's advisory lock, `COMMIT` around one
  write each) for the entry and the reporting row. Folding those is a change to the store
  every host shares, and the next thing to measure.

### The workflow's body, no longer kept with every run (2026-11-28)

Reading the workflow by the hash pinned at entry was a step, and a step's result is
checkpointed: every instance carried a whole copy of its workflow's definition — the same
bytes, once per journey in flight. It holds nothing of the user's; the hash names it for good.
The read is no longer a step, and the host keeps the bodies it has read (`WorkflowCache`, by
content hash, bounded): the store is asked once per version and process. This is the shared
code, so the Cloudflare and AWS hosts stop carrying the copy in their instances' state too,
and run one step fewer.

What it gives up: the read was retried as a step is (five times, over minutes); it is now
retried briefly, like the admission just before it, and then the instance fails. With the
body in memory after the first read, that is one read per version and process.

The same machine, sizes and benchmark; one run of each cell. "Before" is the table of the
first cut in round trips where it has the cell, and the first tables otherwise.

| Engine schema on disk | Before   | After    | Change |
| --------------------- | -------- | -------- | ------ |
| 1M users asleep       | 3,518 MB | 2,336 MB | −34%   |

(The smaller sizes are not compared: the earlier run had 15,000 more finished runs in them.)

| 100k users, a batch queued | Runs/s before | Runs/s after | Change |
| -------------------------- | ------------- | ------------ | ------ |
| 2 hosts, 10 at once        | 434           | 461          | +6%    |
| 1 host, 10 at once         | 406           | 471          | +16%   |
| 4 hosts, 10 at once        | 425           | 460          | +8%    |
| 2 hosts, 50 at once        | 377           | 413          | +10%   |

| 100k users, a wait in service | Before | After | Change |
| ----------------------------- | ------ | ----- | ------ |
| Runs/s to parked              | 266    | 295   | +11%   |
| Runs/s woken to end           | 280    | 324   | +16%   |

| A run of three actions | Before | After  |
| ---------------------- | ------ | ------ |
| Statements             | 38     | 37     |
| WAL                    | 9.5 kB | 5.9 kB |

- **A third of the disk, not most of it**: about 1.2 kB an instance here, where the workflows
  are three nodes long. A longer workflow's copy was larger; the rest of an instance (profile,
  event, entry, reporting row, run, three checkpoints, their indexes) is about 2.3 kB.
- **At a million users the figure that was out of line is not any more**: woken to end, 173
  runs/s before, 320 now, level with the smaller sizes. That fits the guess that the data had
  stopped fitting in memory; it is one run each way and does not prove it.
- The rise in WAL after the first cut is gone with the copy (it was the largest row written);
  why it rose then is still not explained.
