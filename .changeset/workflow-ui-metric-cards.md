---
'@shware/workflow-ui': minor
---

Breaking: `MetricPoint` requires `entered` — the users who entered the workflow in the bucket — and `converted` is now that cohort's conversions, so the Converted card is a share of users (`converted / entered`) instead of a share of delivered messages. The Overview cards headline the whole range (the sent total, and each rate over the whole range) and compare it with the range of the same length just before, instead of the last bucket against the one before it — which made the headline the day still in progress, small and jumpy, and 0 whenever sending paused.
