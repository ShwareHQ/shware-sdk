---
'@shware/analytics': patch
---

Server conversions forwarders now take the client IP address and user agent from each event's `tags.ip_address` / `tags.user_agent`, falling back to `data.ip_address` / `data.user_agent`, the tag winning as it already did for the IP in Meta and Microsoft: Meta and Microsoft gain the user agent, Reddit and OpenAI gain both, LinkedIn gains the per-event IPv4 address. Website events stored with a server-recorded user agent no longer reach Meta without `client_user_agent`, and Meta's missing-user-agent warning now fires only when a website event really has none.
