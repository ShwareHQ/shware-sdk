---
'@shware/analytics': minor
---

`distinct_id` is the server's: dropped from `updateVisitorSchema`, so the client no longer sends it, and added to `Visitor` as the person the visitor belongs to — its own id until someone signs in on it, the user's id from then on. Third-party user setters now receive `VisitorIdentity`, the PATCH payload plus the server's `distinct_id`; `setPosthogUser` identifies by it once a `user_id` is known and no longer identifies an anonymous visitor, since PostHog will not merge one identified person into another at sign-in. Pairs with the api release that maintains the column.
