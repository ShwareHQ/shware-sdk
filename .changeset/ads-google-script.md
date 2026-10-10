---
'@shware/analytics': minor
---

Add `parseGoogleAdsScriptReport` to `@shware/analytics/ads`: it validates the hourly report a Google Ads script posts (ad groups, and Performance Max campaigns, which have none) and turns it into `AdPerformanceRow`s, the account's hours as UTC instants, spend from micros. `AdPlatform` gains `'google'`. The README carries the script, which needs no developer token or manager account.
