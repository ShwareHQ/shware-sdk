---
'@shware/analytics': patch
---

`getTags` remembers that a `?s=` id names no link (a 4xx from `/links/:id`) for the rest of the page instead of asking again for every event; a 5xx or network failure is still retried on the next event. `getLink` now throws for those failures rather than answering `null`.
