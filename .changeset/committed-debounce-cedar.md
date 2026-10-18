---
'@shware/utils': patch
---

Use the latest committed callback and exit policy in debounced React callbacks while retaining pending queues. Calls during a child's layout effect or ref callback now see the prior commit until the parent's layout effect runs. Preserve and document the legacy render-time contract of useLatestRef.
