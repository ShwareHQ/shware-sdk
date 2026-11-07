---
'@shware/workflow': major
---

Add batch ingest: `JourneyClient.ingest` and `POST /ingest` merge a profile and record its events in order, and `JourneyQueue` with `journeyWorker`'s `queue` handler carries the same batch through Cloudflare Queues with retries. The `profile` table gains a nullable `props_at` column, so a redelivered patch cannot overwrite a newer property; regenerate the schema and migrate before deploying.
