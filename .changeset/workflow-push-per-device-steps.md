---
'@shware/workflow': patch
---

A push sends each device in its own durable step, so a failure on one device retries that device alone and the copies already delivered are not sent again.
