---
'@shware/http': patch
---

Stop installing `vitest` for consumers (it was listed under `dependencies` but only the tests use it) and drop the unused optional `react` peer.
