---
'@shware/analytics': minor
---

Page views follow the industry line: a path _or query_ change is a new page, a hash change is not.

`useWebAnalytics` had fired `page_view` on the pathname alone, so `?page=2` or `?q=shoes` never counted as a page — where GA4's enhanced measurement, Next.js's `usePathname` + `useSearchParams` pattern and PostHog's `history_change` all count it. The hook now takes the router's query string as a required second argument, and the `tanstack`, `next` and `react-router` `Analytics` components pass it (the Next one under its own Suspense boundary, as `useSearchParams` requires). The hash stays out: an in-page anchor is not a navigation.

Tracking parameters — `utm_*` and the ad click ids `getTags` captures — are stripped before comparing, so a landing page that cleans them out of its URL with `replaceState` is not counted twice (`getPageKey`). `page_load_id` rotates on exactly the same changes, keeping every id pointed at a page view. `page_path` and `previous_page_path` remain paths; the query is in `page_location`.
