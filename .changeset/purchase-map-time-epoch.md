---
'@shware/purchase': patch
---

`mapTime` maps `0` to the epoch instead of `null`, maps only `null` / `undefined` to `null`, and accepts `undefined`.
