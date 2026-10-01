---
'@shware/analytics': minor
---

`classifyTouch` no longer counts the `_fbc` cookie as a Meta click: it outlives the visit by 90 days, so it named later direct, search and email visits Meta. `fbclid`, read from the landing URL, still counts. A `utm_source` without a `utm_medium` is `cpc` when an ad-only click id of the same channel came with it (`AD_CLICK_IDS`: Google's, Microsoft's, TikTok's, Reddit's; not `fbclid`, which Meta puts on organic links too). `utm_source=th` (Meta's Threads placement) folds into `meta`. The comments record why a `utm_source` outranks a click id. Reclassify stored sessions after upgrading.
