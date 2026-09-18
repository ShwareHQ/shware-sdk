---
'@shware/analytics': patch
---

Move the LinkedIn Conversions API to version `202609`. Version `202509` was sunset and every call was failing with `426 NONEXISTENT_VERSION`, so no server-side LinkedIn conversion was being recorded. The `202609` schema also drops `ORACLE_MOAT_ID` as a user identifier type and adds `PLAINTEXT_IP_ADDRESS`, `SHA256_IP_ADDRESS` and `GOOGLE_AID`; `UserIdType` now matches it. The endpoint, headers and batch-create envelope are unchanged.
