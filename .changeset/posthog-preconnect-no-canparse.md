---
'@shware/analytics': patch
---

`posthogAnalytics` no longer throws in browsers without `URL.canParse` (Safari before 17, Chrome before 120).
