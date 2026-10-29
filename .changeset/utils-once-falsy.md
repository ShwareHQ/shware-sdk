---
'@shware/utils': patch
---

`once` tracks whether it has settled, so a falsy result (`0`, `''`, `false`, `null`) is returned from the cache like any other.
