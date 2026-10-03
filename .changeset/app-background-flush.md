---
'@shware/analytics': patch
---

`useAppAnalytics` sends the queue as soon as the app goes to the background, after its engagement event, instead of after the batch delay: the app may be suspended or killed before that, losing the queue — a new session's `session_start` among it.
