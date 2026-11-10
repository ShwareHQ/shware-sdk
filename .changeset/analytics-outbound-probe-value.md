---
'@shware/analytics': patch
---

The registrable-domain probe behind `useOutboundClickAnalytics` reads its cookie back by a value made for that one probe, so a cookie of the same name the site already holds can neither pass a refused suffix nor hide the probe; the probe is now tested against a real cookie jar.
