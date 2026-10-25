---
'@shware/analytics': major
---

Remove `trackAsync`. It existed to wait for the server's event id before firing the pixels and to get a send out before a full-page navigation; since 12.1 ids are generated on the client, pixels fire inside `track()`, and the queue goes out by beacon when the page is left, so `track` covers both. Replace `await trackAsync(name, props)` with `track(name, props)`.
