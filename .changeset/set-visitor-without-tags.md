---
'@shware/analytics': minor
---

`setVisitor` no longer sends the current page's tags: at sign-in the page is the login page, not where the visit came in, and the server already refreshes `visitor.tags` from each `session_start`. `updateVisitorSchema` takes `tags` as optional, so servers on this version accept a sign-in without them and still merge the tags of clients before 11.1. Upgrade the server before the clients.
