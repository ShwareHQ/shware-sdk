---
'@shware/purchase': patch
---

Removes the unused `METADATA_KEYS.CREDIT_AMOUNT` and `METADATA_KEYS.CREDIT_EXPIRES_IN`; nothing in the SDK reads or writes `credit_amount` / `credit_expires_in` metadata.
