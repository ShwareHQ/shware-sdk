---
'@shware/analytics': patch
---

Meta and Microsoft Conversions API forwarders now take the client user agent from each event's `tags.user_agent` (falling back to `data.user_agent`), as they already do for the IP address, so website events stored with a server-recorded user agent no longer reach Meta without `client_user_agent`; Meta's missing-user-agent warning now fires only when a website event really has none.
