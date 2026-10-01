---
'@shware/analytics': minor
---

Google Ads (Data Manager API): new `actionType` option, `'webpage'` (default) or `'offline'`, for the kind of conversion action the events go to. A webpage action — the one the gtag tag reports to — accepts `eventSource` `WEB` or none, and fails the whole request on any other value, so non-web events are now sent there without `eventSource` instead of `APP` / `OTHER`. An offline (upload) action requires `eventSource` and keeps getting `WEB`, `APP` or `OTHER` from the platform.
