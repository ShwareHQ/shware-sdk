---
'@shware/purchase': major
---

`createCheckoutSessionSchema` now requires `{ allowedOrigins }` and refuses `cancelUrl` / `successUrl` outside those origins, closing an open redirect through Stripe Checkout; the new `returnUrlSchema(allowedOrigins)` and `isAllowedReturnUrl` cover other return URLs such as the billing portal's.
