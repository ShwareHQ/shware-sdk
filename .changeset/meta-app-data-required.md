---
'@shware/analytics': patch
---

Meta Conversions API: send app events with `action_source: 'app'` only when the package name and an iOS/Android OS are known (`extinfo` version `i2`/`a2`), otherwise `other`; always set the required `advertiser_tracking_enabled`.
