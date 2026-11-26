---
'@shware/workflow': patch
---

Fixes from the workflow review, third batch: what a running journey keeps from the version it entered on.

- A send checks the opt-out of the topic its template declares now, not the one compiled into the journey's pinned IR. A template moved to another topic, or from transactional to a topic, kept being sent to journeys already running under the old value: users who had unsubscribed still got it, and the copy's unsubscribe link named a topic the send had not checked. `redelivery` is read the same way. `MessageValidator` gains an optional `describe()`, which `registryValidator` implements; a custom validator without it keeps the compiled-in values.
- The in-flight check before a deploy also covers events: an event a running journey emits (`sendEvent`) that the contract no longer declares or now refuses, and an event a `waitUntil`, `exitWhen` or goal still waits for that is gone from the contract. These deploys were let through and the journeys failed, or waited out their timeout. `?force=1` deploys anyway, as before.
- `ir.ts` no longer claims readers migrate older IR versions: they accept the current one only.
