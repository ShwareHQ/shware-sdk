---
'@shware/workflow': minor
'@shware/workflow-ui': patch
---

A journey can read the event that started it, an event's payload has a size limit, and following an unsubscribe link is no longer a click.

`@shware/workflow`

- **`trigger.event()` returns a handle on the triggering event.** `const checkout = trigger.event(e.begin_checkout)`, then `checkout.payload.<field>` — typed by the event — goes wherever a profile property can: a predicate (`branch`, `filter`, `waitUntil`, the goal, `exitWhen`), a message prop, a `sendEvent` payload, an action argument. Until now a journey could only test the event log (`performed(e.begin_checkout, (p) => gte(p.value, 100), { within: '1 day' })`), which answers for any occurrence in the window, not the one that entered. The value is a snapshot: the journey reads the payload it entered with for as long as it runs. Scalars only — a nested field is reached by its path (`checkout.payload.cart.items`), and an object, an array or a field the event left out reads as missing. `compileBundle` refuses a reference taken from another trigger, one in a workflow with a segment, date or webhook trigger, and one in a segment or a trigger `filter`; with a contract, `compileConfig` checks every field read is one the event declares, and `checkInFlight` reports a field a running journey reads that a deploy would drop from the contract. In IR the references are new optional forms (`trigger_payload`, as a condition and as a value): `irVersion` is unchanged and so is every existing content hash. Existing code needs no change — `trigger.event()` still returns a `TriggerRef`.
- **An event's payload may be at most 128 KiB as JSON** (`MAX_EVENT_PAYLOAD_BYTES`). `POST /ingest` and a queued batch refuse a larger one with a 400 naming the event and its size; `ingestEvent` called directly throws `EventPayloadTooLargeError` (a 413 from `handleRequest`). A triggering event's payload travels in the instance's parameters, which the runtimes cap (Cloudflare Workflows at 1 MiB), so an oversized one used to surface as an instance that failed to start. **If you send payloads over 128 KiB, they are now refused.**
- **Following an email's unsubscribe link is not a click of the copy.** The click is still recorded and still counts as an open, but it no longer sets `clicked_at` / `human_clicked_at`, so click rates are about the links of the content. **Migration required:** `message_link` gains a nullable `purpose` column — regenerate the drizzle file (`workflow-ui generate`) and migrate before deploying; `POST /bundle/deploy` answers 503 until it exists. No data step: links recorded before keep a null purpose, so unsubscribe clicks on emails already sent go on counting. `JourneyReporting.recordLinks` takes `{ url, purpose }` entries as well as bare URLs.

`@shware/workflow-ui`

- The canvas labels a condition on the triggering event's payload as `trigger.<field>`, and the inspector lists its value.
- The links report leaves out clicks on unsubscribe links. It reads the new `message_link.purpose` column, so upgrade it together with `@shware/workflow` and run the migration first.
