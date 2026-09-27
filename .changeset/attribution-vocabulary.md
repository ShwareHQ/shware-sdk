---
'@shware/analytics': minor
---

`@shware/analytics/attribution`: the vocabulary attribution is built from, as data — `CHANNELS` and `CHANNEL_GROUPS` (GA4's default channel groups as identifiers), `SOURCE_ALIASES`, `CLICK_ID_CHANNELS` (every click id this SDK collects, mapped to its channel and checked against `AdvertisingInfo`), `REFERRER_SITES` (search engines and social networks by host pattern, with the medium GA4 gives them), `REFERRERS_NOT_A_TOUCH` (payment and sign-in hosts), `AD_LANDING_PAGE`, the paid / display / email medium rules, `TOUCH_SOURCES`, `REPORTED_TOUCH_KINDS` and `TOUCH_PRIORITY`. No SQL and no runtime code: a product's `touchpoint` view is generated from these, so a channel added here reaches every product on upgrade, and dashboards share the same names.
