---
'@shware/workflow': major
---

Replace `track` and `identify`, with `POST /events` and `POST /identify`, by one write: `ingest({ userId, visitorId, profile, events })` on `JourneyClient` and `POST /ingest`, which merges a visitor, then the profile, then records the events in order. `JourneyQueue` with `journeyWorker`'s `queue` handler carries the same batch through Cloudflare Queues with retries. Regenerate the schema and migrate before deploying: `profile` gains `props_at`, so a redelivered patch can't overwrite a newer property.
