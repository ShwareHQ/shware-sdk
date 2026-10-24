---
'@shware/analytics': patch
---

Subscribe to web-vitals once per mount in `useReportWebVitals`, so `Analytics` no longer reports each Core Web Vitals metric again after every route change.
