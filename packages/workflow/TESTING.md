# Testing conventions

## Layout

All tests live in `tests/` — `src/` ships, `tests/` never does.

| File                                 | Scope                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `fixtures.ts`                        | Shared schema, segments, templates and workflows used across the suite              |
| `dsl.test.ts`                        | DSL surface → IR: predicates, combinators, triggers, nodes, bundle rules            |
| `compile.test.ts`                    | Whole-workflow compilation: tree shape, node ids, hashes, build guards              |
| `ir.test.ts`                         | The zod schemas as the authoritative IR definition                                  |
| `hash.test.ts`                       | SHA-256 known-answer vectors, canonical JSON, metadata stripping                    |
| `plan.test.ts`                       | Hash semantics (metadata exclusion) and deploy diffing                              |
| `engine.test.ts`                     | Interpreter semantics over in-memory ports                                          |
| `pglite.ts`                          | `pgliteDatabase()`: a migrated Postgres (PGlite, in-process), the suite's one store |
| `fake-cloudflare.ts`                 | `FakeJourney`: an in-memory Workflow binding, and `makeEnv` around it               |
| `stubs/cf-step.ts`                   | `FakeCfStep`: a replaying `WorkflowStep` (`replay()`, scripted wakes, `evictAt`)    |
| `runner.test.ts`                     | The Cloudflare step adapter: timeouts after eviction, NonRetryableError             |
| `worker.test.ts`                     | `journeyWorker`: leases, own-bundle deploys, the sweep, the Workflow binding port   |
| `execute.test.ts`                    | One run end to end over the ports: ledger, failure path, subscriptions              |
| `aws.test.ts`                        | The Lambda adapter: starts, waits, sweep pages, forged runs                         |
| `channels.test.ts`                   | Senders from the config: provider cache, dead tokens, secrets                       |
| `postgres-store.test.ts`             | The Postgres store on PGlite: schema check, entries, erasure, pages                 |
| `facts.test.ts`                      | Fact source over the store: the profile read's scalar boundary                      |
| `ingest.test.ts`                     | Ingest: deploy routing, trigger gates, entry-once, segment entries, sweep pages     |
| `http.test.ts`                       | The HTTP surface: identify, wakes, auth, validation, the host's gate and routes     |
| `provenance.test.ts`                 | Callsite recording (meta.loc): capture, hash exclusion, portability                 |
| `public-api.test.ts`                 | Consumer-perspective smoke: public entry points only, end to end                    |
| `types.test-d.ts`                    | Type-safety regressions (never executed, see below)                                 |
| `integration/postgres-locks.test.ts` | The store's per-user locks over two real Postgres connections (see below)           |

## Rules

1. **Fixtures import the public entry only** (`../src/index`). They double as a
   consumer smoke test; if a fixture needs a deep import, the public surface is
   missing something — fix the surface, not the fixture.
2. **Deep imports are allowed only where the test is about internals**
   (`engine.test.ts` white-boxes `src/engine`, `ir.test.ts` the schemas).
3. **The package exports no demo content.** Showcase flows live in
   `examples/playground/src/marketing`; the fixtures mirror their shapes so the
   suite keeps exercising realistic trees, but they are independent copies.
4. **Engine semantics are tested through ports** (`EngineStep`, `FactSource`,
   …), never against a platform. Adapter-specific behaviour belongs to the
   adapter's own future suite; `examples/cloudflare-demo` is a manual
   verification harness, not a test.
5. **Every public API change lands with tests in the same commit** — functional
   coverage here, plus a `types.test-d.ts` entry when the type surface moved.

## Integration tests (real Postgres)

`tests/integration/postgres-locks.test.ts` proves what PGlite cannot: that two transactions on
separate connections order themselves under the store's per-user advisory lock
(`src/store/user-lock.ts`). The control points: an entry committing late is found by the
erasure; an erasure committed first refuses the entry and the runner's admission; a rollback
releases the lock; one user's lock holds no other user. The plain writes, parameterised over
`insertEvent`, `mergeProfile`, `upsertDevice`, `addSegmentMember`, `subscribe`,
`reporting.instanceStarted` and `reporting.recordMessage`: written first, the erasure waits
and then takes the rows, with no second pass; erased first, the write waits for the lock,
reads the tombstone on a fresh snapshot and writes nothing (connection A defaults to
REPEATABLE READ, so these cases fail if the store stops pinning its transactions to READ
COMMITTED). The copy's child rows (links, opens, clicks) take the user lock before the copy's
row, so an erasure racing them leaves no orphan and no revived copy; after `forgetUser` every
table is empty at once and a repeat is idempotent. It needs a real server, named by
`WORKFLOW_TEST_DATABASE_URL`; a plain `postgres:17` with default settings is enough, and the
run creates and drops a schema of its own:

```sh
docker run --rm -d --name workflow-pg -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17
WORKFLOW_TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres pnpm exec vitest run tests/integration
```

Every interleaving is driven by barriers the test releases, never by sleeps. Each connection has
one socket: while a transaction on it waits for the lock, nothing else may be sent to that
connection's store until the gate holding the lock is released.

Without the variable the file still runs under `pnpm test`, skips its suite and warns
(`[integration] WORKFLOW_TEST_DATABASE_URL unset`) — never silently.

## Type tests

`types.test-d.ts` is validated by `tsc --noEmit` (`tests/` is in the tsconfig
include), not executed by vitest:

- every `@ts-expect-error` line asserts that the exact misuse below it fails to
  compile — if the error stops firing, the _unused directive_ fails the build;
- `expectTypeOf` assertions check inference results (phantom types on refs,
  props inferred from template registries).

This makes the type system's guarantees regression-tested by the same
`check-types` gate that CI already runs.

## Comment and naming language

Source comments and all test names are English (the package is headed for open
source). Test names state observable behaviour, not implementation.
