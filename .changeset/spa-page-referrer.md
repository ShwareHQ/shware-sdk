---
'@shware/analytics': patch
---

Report the previous page as `page_referrer` after an in-app navigation, as GA4 does, instead of `document.referrer`, which a single page app never updates: a session opened later in the visit no longer counts the site the visit came from a second time.
