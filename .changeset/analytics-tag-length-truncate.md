---
'@shware/analytics': minor
---

Truncate every free-form string tag (page_location, page_referrer, utm_*, click ids, campaign names, the deprecated legacy fields, …) to 1024 characters instead of accepting it unbounded. Nothing previously valid is rejected; an oversized tag is shortened rather than failing its batch.
