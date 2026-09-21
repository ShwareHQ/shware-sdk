# @shware/workflow

Code-first customer journeys. Workflows are written as TypeScript, compiled to a
versioned IR, and executed by a single generic runner: the IR is data, so one
deployed Worker runs every journey.

```ts
const welcome = workflow('welcome', { trigger: trigger.event(e.sign_up) })
  .email(gettingStarted)
  .delay('3 days')
  .waitUntil(performed(e.activated), {
    timeout: '7 days',
    onTimeout: (w) => w.email(nudge),
  });
```

## The three planes

| Plane     | What it is                                 | Where it lives                |
| --------- | ------------------------------------------ | ----------------------------- |
| Authoring | The DSL, compiled to IR by `compileBundle` | `@shware/workflow`            |
| Execution | The interpreter, over abstract ports       | `@shware/workflow/engine`     |
| Adapter   | Cloudflare bindings, ingest, runner        | `@shware/workflow/cloudflare` |

The interpreter never touches a database or a network. Everything it needs
arrives through the ports in `engine/ports.ts`, which is what makes a journey
testable without deploying one.

## Versioning

Every workflow carries a `contentHash` over its own IR, with metadata excluded,
so a reworded description is not a new version but a changed delay is. The hash
is the KV address the IR is stored under, and a journey is pinned to the hash it
entered on. An in-flight journey therefore finishes on the version it started,
however many times you deploy underneath it.

`plan()` diffs a compiled bundle against what is deployed and reports which
workflows actually changed. Deploy recomputes every declared hash and refuses a
bundle whose hashes do not describe its contents.

## Cloudflare setup

The adapter needs three bindings, named as in `JourneyEnv`:

| Binding       | Type         | Holds                                     |
| ------------- | ------------ | ----------------------------------------- |
| `WORKFLOW_KV` | KV namespace | Compiled IR, content-addressed by hash    |
| `DB`          | D1 database  | Events, profiles, routing, entries, wakes |
| `JOURNEY`     | Workflow     | The `JourneyRunner` entrypoint            |

Set `API_TOKEN` in production. Without it every mutating endpoint is open, and
`/deploy` rewrites the whole routing table.

The D1 schema ships with the package. Apply it before the first deploy:

```bash
wrangler d1 execute <database> --file node_modules/@shware/workflow/dist/cloudflare/schema.sql
```

Nothing in the adapter creates these tables at runtime, so this step is not
optional. The same file lives at `src/cloudflare/schema.sql` in this repo and is
the single source for both.

There are no migrations, and re-applying the file is not one: every statement is
`CREATE TABLE IF NOT EXISTS`, so an existing database keeps its old tables and
the first insert needing a new column fails. Recreate it instead. The demo has
`pnpm db:reset`.

## HTTP surface

`handleRequest` serves four endpoints.

- `GET /health` is the only unauthenticated one.
- `POST /events` takes `{ userId, event, payload?, ts?, id? }` and answers with
  the id the occurrence was recorded under. Event names beginning with `$` are
  reserved for internal use.
- `POST /identify` takes `{ userId, props }` and merges the properties into the
  profile. A property set to `null` is removed, which is the only way to unset
  one.
- `POST /deploy` takes a compiled bundle and swaps the routing table atomically.

### Give each event an `id`

`id` is the occurrence's identity, and sending the same one twice records it
once. This matters because every count- and window-based condition reads the
event log, so a second copy of one event silently changes what a journey
decides.

Only the sender knows whether two deliveries describe one occurrence or two, so
the engine never guesses. An event that arrives without an id is given a fresh
one, which records it as its own occurrence. If you retry a request, send an id
you can reproduce and the retry costs nothing.

```json
{ "id": "order-8841-confirmed", "userId": "u_123", "event": "purchase" }
```

Use something that identifies the occurrence, not the event name: a row id from
your own system, an upstream webhook's delivery id, or a message id from your
queue. Workflows emitting events through `send_event` already do this, passing
the node's identity within the running instance.

## Entry policy

A user enters a workflow at most once. The entry ledger's primary key enforces
it, which also makes the check atomic under concurrent ingests. The one
exception is an entry whose instance died: that row records a failure, not a
journey the user received, so the next trigger reclaims it. Re-entry beyond that
is a design question this package does not yet answer.

## Testing

See [TESTING.md](./TESTING.md). The interpreter runs against in-memory ports and
the Cloudflare adapter against fakes that dispatch on the exact SQL strings the
real code sends, so changing a query means updating the fake, deliberately.
