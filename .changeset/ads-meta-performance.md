---
'@shware/analytics': minor
---

Add `@shware/analytics/ads`: `fetchMetaAdPerformance` reads Meta ad delivery from the Insights API over `fetch` — one typed `AdPerformanceRow` per ad and hour, `hour_start` in UTC, spend, impressions, link clicks, and the platform's conversions with their click-through part — with `channel` / `medium` / `channel_group` from the attribution vocabulary, so the rows join sessions and attribution as they are. Ranges are fetched in 7-day windows; a `since` past Meta's 13 months of hourly data throws instead of returning nothing.
