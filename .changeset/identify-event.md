---
'@shware/analytics': minor
---

`setVisitor` binds the user through an `identify` event instead of a `PATCH /visitors/:id`: it hands the user to the third-party setters at once (the user's id as the distinct id) and queues `identify` with `{ user_id }` when the user differs from the one the page last identified, so the binding travels with the events that create the visitor and can never arrive before it. It is now synchronous, returns nothing and never throws. `IDENTIFY_EVENT` is exported for servers, which must bind the visitor from it (README, "Visitors") before clients upgrade; `identify` is never forwarded to third parties.
