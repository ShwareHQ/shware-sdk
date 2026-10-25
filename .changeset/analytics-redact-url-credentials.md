---
'@shware/analytics': patch
---

Strip credential query parameters (`code`, `state`, `token`, `access_token`, `id_token`, `refresh_token`, `session_id`, `api_key`, `apikey`, `secret`, `password`, `otp`) from `page_location` and `page_referrer` on the web, and from a native deep link's `page_location`, before reporting.
