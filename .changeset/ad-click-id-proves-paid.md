---
'@shware/analytics': minor
---

`classifyTouch`: an ad-only click id of the utm's own channel now makes the medium `cpc` when the declared `utm_medium` puts the touch in an organic group (a Reddit ad tagged `utm_medium=social` with `rdt_cid`), not only when the medium is missing. Click ids of another channel and `fbclid` still never override the utm.
