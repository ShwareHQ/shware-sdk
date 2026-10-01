---
'@shware/analytics': minor
---

`classifyTouch` no longer counts the `_fbc` cookie as a Meta click: it outlives the visit by 90 days, so it named later direct, search and email visits Meta. `fbclid`, read from the landing URL, still counts. A `utm_source` without a `utm_medium` is `cpc` when a click id of the same channel that its platform puts on ad clicks only came with it: `CLICK_ID_CHANNELS` entries gain a third element, `'ads'` or `'any'` (`fbclid` is `'any'`: Meta puts it on organic links too). Code destructuring `[key, channel]` is unaffected. `utm_source=th` (Meta's Threads placement) folds into `meta`. The comments record why a `utm_source` outranks a click id. Reclassify stored sessions after upgrading.
