---
'@shware/http': patch
---

Document that `rateLimit` reads and writes its bucket with no atomic operation on the store: a soft cap for a fast, consistent store such as Redis, not a fit for Cloudflare Workers KV, where the Workers Rate Limiting binding is the tool.
