---
'@shware/analytics': patch
---

Reddit Conversions API: an offline or undeterminable event is sent with `action_source: 'OTHER'` instead of `'UNKNOWN'`, which is not one of Reddit's values (`WEBSITE`, `APP`, `PHYSICAL_STORE`, `OTHER`). Website events now carry `event_source_url`, from which Reddit reads the domain and, when `click_id` is missing, the click id.
