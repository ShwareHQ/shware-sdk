---
'@shware/analytics': patch
---

Keep retrying the deduplicated POSTs explicitly now that `@shware/utils`' `fetch` no longer retries POST by default: the `/events` batch (client-generated event ids) and the Meta, Reddit, LinkedIn, Microsoft, OpenAI and Google Data Manager conversions requests (their per-event ids). `/feedback` and `/links` creation, which have no deduplication key, are no longer retried.
