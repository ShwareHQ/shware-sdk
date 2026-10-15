---
'@shware/workflow': patch
---

The validated environment from `journeyWorker({ env })` is used everywhere — the fetch handler, the segment sweep and the workflow runner — and an invalid environment answers 500 instead of crashing with an opaque error.
