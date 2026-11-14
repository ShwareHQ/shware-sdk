---
'@shware/workflow': major
---

`timeWindow({ tz: 'user' })` reads the profile property `time_zone` instead of `timezone`, the snake-case name of the analytics `time_zone` tag a host fills it from. A host that sets `timezone` on its profiles must rename it to `time_zone`; until it does, user-zone windows fall back to UTC.

Under a `timeScale` other than 1, `timeWindow` steps are skipped: a time of day cannot be compressed, and a rehearsal reaching a 09:00 window at night would otherwise sleep real hours.
