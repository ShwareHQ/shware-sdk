---
'@shware/workflow': minor
---

Add `forgetUser(userId)` (client, `POST /users/forget`, and the Cloudflare export) for erasure requests: it deletes the user's profile, events, devices, subscriptions, segment memberships, suppressions, messages and their opens, clicks and links from the store, and terminates the user's running journey instances.
