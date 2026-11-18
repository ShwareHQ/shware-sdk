---
'@shware/purchase': patch
---

`expanded()` throws a `TypeError` (still an `Error`, same message) when a Stripe object was retrieved without expanding the field.
