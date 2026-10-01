---
'@shware/analytics': minor
---

Collect two more ad click ids from the landing URL: `oppref` (OpenAI's ChatGPT Ads) and `epik` (Pinterest Ads). Both name their channel in `classifyTouch` (`chatgpt`, `pinterest`), so an ad click without utm tags is a paid touch and not organic AI or a referral, and the OpenAI Conversions API events now carry `oppref`, which OpenAI matches conversions to clicks with. Snapchat's click id is read as `ScCid`, the case Snapchat appends it in (it was never captured before), and the tag is renamed from `sccid` to `ScCid` so that every click id tag is named after its URL parameter. `li_fat_id`, `ScCid`, `yclid`, `oppref` and `epik` are marked `'ads'` in `CLICK_ID_CHANNELS`. The pixels' `__oppref` / `_epik` cookies are not read: a click id names the visit's channel, and a cookie outlives the visit.
