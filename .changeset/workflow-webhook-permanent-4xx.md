---
'@shware/workflow': patch
---

Discord and Slack webhook senders settle a copy undelivered on any permanent 4xx (not 408 or 429) instead of throwing, so a message the channel rejects is never retried.
