---
'@shware/analytics': minor
---

`classifyTouch` reads a tag made only of ad platform macros the platform did not expand (`{{campaign_name}}`, `{{ad_name}}_{{ad_id}}`, `__CAMPAIGN_NAME__`, `{campaignid}`) as no value, so it no longer lands in `campaign` or names a channel; Meta's `{{placement}}` as a medium still marks a Meta ad. `META_PLACEMENTS` adds Meta's current `facebook_feed`, `facebook_instream` and `threads_stream`, which were read as organic social. Reclassify stored sessions after upgrading.
