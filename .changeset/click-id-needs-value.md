---
'@shware/analytics': minor
---

`classifyTouch` counts a click id only when it has a value. Clients before mid-2025 wrote every missing URL parameter as `null` into the tags, and reading the key alone named those sessions Meta clicks — Google ad clicks among them, since `fbclid` is listed first. A null, empty, `undefined` or `null` string value is no click now. Reclassify stored sessions after upgrading.
