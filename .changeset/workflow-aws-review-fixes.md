---
'@shware/workflow': minor
---

Fix five correctness problems in the AWS durable Lambda adapter. Postgres hosts must migrate: regenerate the drizzle schema (`workflow-ui generate`) for the new `version` column on `trigger` and `segment_trigger` and `stopped_at` on `execution`, and run the migration before deploying.

- Erasure no longer deletes a user's data the moment their execution is stopped. A stop does not interrupt an invocation already running; it goes on to its next checkpoint, side effects included. The erasure now records the stop and stays pending for `stopDrainMs` (15 minutes by default, a new `journeyLambda` option), and the sweep finishes it. An execution that already finished on its own is erased at once.
- Each route records the code version that applied it (`TriggerRoute.version`, `SegmentTriggerRoute.version`). An instance runs on that version instead of on a "live" version read separately, which a release between the two reads could make another bundle's.
- The workflow IR is read inside a durable step (`$workflow:ir`). A transient database failure is retried, and one that persists fails the entry instead of leaving it `running`.
- A failed entry reclaimed under the same instance id (an event replayed with its ts) gets a new execution identity. `executionName(instanceId, attempt)` now takes the attempt's token; before, the old name returned the closed execution and nothing ran.
- The Node HTTP/2 client discards only the session a timed-out request was on (`Http2Sessions.discard(origin, session)`), not a newer one opened after a GOAWAY.
