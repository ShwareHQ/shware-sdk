---
'@shware/analytics': major
---

Replace `setVisitor` with `identify(userId, userData?)` and `reset()`: `reset()` ends the current session (reporting its engagement as `user_engagement` with `trigger: 'reset'`) and starts a new visitor, so a visitor only ever belongs to one user; `identify` resets first when another user signs in over the last one, and every event now carries the visitor it was tracked under.
