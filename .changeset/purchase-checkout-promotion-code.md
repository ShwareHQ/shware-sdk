---
'@shware/purchase': minor
---

`createCheckoutSessionSchema` accepts an optional `promotionCode` (a customer-facing Stripe code such as `SAVE20`, trimmed, 1–200 characters), exported on its own as `promotionCodeSchema`; `CreateCheckoutSessionDTO` carries the same field.
