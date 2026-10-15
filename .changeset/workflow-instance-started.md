---
'@shware/workflow': minor
---

Instances are reported when they enter (`JourneyObserver.started`, `JourneyReporting.instanceStarted`), before the entry guards: an instance a goal or `exitWhen` ends at once is no longer missing from the reports. `instance.node_id`/`node_at` are nullable and `instanceFinished` upserts; regenerate the schema and migrate.
