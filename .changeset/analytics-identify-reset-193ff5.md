---
'@shware/analytics': major
---

Replace `setVisitor` with `identify(userId, userData?)` and `reset()`: `reset()` ends the current session (reporting its engagement as `user_engagement` with `trigger: 'reset'`) and starts a new visitor, so a visitor only ever belongs to one user; `identify` resets first when another user signs in over the last one, and every event now carries the visitor it was tracked under. Third-party user setters now receive `{ user_id, user_data }` only (`distinct_id` is gone; PostHog is identified by `user_id`), and an empty object on `reset()`. Servers must now bind a visitor to one user only (see README, "Visitors"), shipped together with this upgrade: a device that upgrades while signed out has no user stored to compare, and an unconditional rebind would hand the previous user's history to the next account.
