---
'@shware/purchase': minor
---

What a host answers its clients about a purchase, typed here instead of in every host: `CheckoutSession.customer_type` (host-set, carried by `getPurchaseProperties` into the `purchase` event as GA4's `customer_type`), an explicit `Charge` / `PaymentIntent` type on `mapCharge` / `mapPaymentIntent`, `mapPaymentMethod` with its `PaymentMethod` type, and the store verify request schemas: `appStorePurchaseSchema` / `appStoreSyncSchema` (`@shware/purchase/app-store`, with `APP_STORE_ENVIRONMENTS`) and `googlePlayPurchaseSchema` (`@shware/purchase/google-play`).
