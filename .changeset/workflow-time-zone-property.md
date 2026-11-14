---
'@shware/workflow': major
---

`timeWindow({ tz: 'user' })` reads the profile property `time_zone` instead of `timezone`, the snake-case name of the analytics `time_zone` tag a host fills it from. A host that sets `timezone` on its profiles must rename it to `time_zone`; until it does, user-zone windows fall back to UTC.
