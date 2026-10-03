---
'@shware/analytics': minor
---

OpenAI Conversions API: send the app events — `first_open` as `app_installed` and `app_open` as `app_opened` (`customer_action`) — for events from an app only, with `action_source` `mobile_app`, as OpenAI takes them through the Conversions API alone; the pixel never sends them.
