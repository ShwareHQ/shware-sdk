---
'@shware/analytics': minor
---

Add `fetchMetaAdPerformanceHistory` to `@shware/analytics/ads`: Meta's daily ad rows for the days before its 13 months of hourly data (up to its 37 months), each spread evenly over the hours of the account's day so a table stays hourly — whole-day sums exactly Meta's. It refuses days that still have hourly data. Also exports `spread`.
