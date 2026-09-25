---
'@shware/analytics': patch
---

A `session_start` whose batch the server rejected goes out again with the session's next batch, under the same session id and with its original tags and timestamp. `fetch` already retries transient failures; this covers a batch rejected outright — one invalid event fails the whole batch, and the session's only attribution record with it — after which every later event of the session had no `session_start` to be attributed through. A session that has timed out in the meantime is not announced late: the carried-over start is dropped when the next batch opens a new session.
