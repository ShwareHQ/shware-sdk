---
'@shware/analytics': patch
---

`useOutboundClickAnalytics` counts outbound clicks the way GA4 does: only http(s) links (`mailto:` and `tel:` are no longer reported as outbound with an empty domain), and only to hosts outside the site's registrable domain, found with the cookie probe `cookie_domain: 'auto'` uses, so a link from `www.` to `app.` of the same site is not outbound. `isOutboundLink` and `registrableDomain` are exported for tests and hosts.
