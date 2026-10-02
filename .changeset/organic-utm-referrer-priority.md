---
'@shware/analytics': minor
---

`classifyTouch`: a utm, click id or ad landing page whose touch lands in an organic channel group or referral (`utm_source=chatgpt.com`, `utm_medium=organic`) now ranks with the referrer (`TOUCH_PRIORITY.referrer`) instead of as a campaign, so it no longer takes the credit from an ad clicked earlier in the attribution window. Reclassify stored sessions after upgrading.
