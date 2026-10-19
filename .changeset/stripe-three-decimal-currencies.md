---
'@shware/utils': minor
'@shware/purchase': patch
'@shware/analytics': patch
---

Fix Stripe minor-unit conversion: three-decimal currencies (BHD, JOD, KWD, OMR, TND) now divide by 1000 instead of 100, and UGX is treated as two-decimal like ISK, matching how the Stripe API represents its amounts. `@shware/utils` exports the new `THREE_DECIMAL_CURRENCIES`; `@shware/purchase`'s `minorUnits` / `price` and `@shware/analytics`' `stripeMinorUnits` now share its single table.
