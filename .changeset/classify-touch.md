---
'@shware/analytics': minor
---

`@shware/analytics/attribution`: `classifyTouch(tags, options)` reads the tags a session arrived with as one touch — `channel`, `medium`, `channel_group`, `campaign`, `priority` — by the rules the vocabulary describes: an explicit `utm_source` (aliases folded), a click id, an ad landing page, the product's own rules (`options.rules`, e.g. a referral landing page), the referrer's host (search engines and social networks folded, payment / sign-in providers and `options.ownHosts` ignored), `(direct)` otherwise. `channelGroupOf(channel, medium)` is GA4's default channel grouping on its own. Products run this once when a session is written and store the result, instead of re-deriving it in a view per query.
