---
'@shware/workflow': patch
---

Fixes from the workflow review, second batch: the path from an event to a journey.

- Segment membership is judged on the host's clock at ingest, not on the event's `ts`. An old event delivered late (an offline buffer, a backfill) no longer moves every `within` window back with it, enters the user into a segment they are not in today and starts its journeys. A membership an event creates now begins at the time of the ingest.
- A redelivery acts on the event as it was first stored. A retry that repeats the `id` but not the `ts` (`sendEvent`, a client stamping `now` per attempt) derived another instance id and could not finish a start the first attempt left behind; the journey was lost. `JourneyStore` gains `storedEvent(userId, id)` for this: **a custom store has to implement it.**
- An event redelivered over an instance that already ended (terminated by hand, errored before finalizing) no longer throws on every attempt. The entry is recorded as failed, a warning is logged and the rest of the batch is applied; before, the batch answered 500 forever and a queue sent it whole to the dead letter queue.
- The queue consumer retries a batch the contract refuses instead of acknowledging it. A producer deployed ahead of the host no longer loses those batches: they pass once the host is deployed, or end in the dead letter queue. **Declare a dead letter queue if you have none — without one Cloudflare drops the message after `max_retries`.**
- Entering a segment the user is already in (two evaluations racing) no longer records a second start, which ran a second journey under `concurrent` re-entry.
