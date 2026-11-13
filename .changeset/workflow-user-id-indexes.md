---
'@shware/workflow': patch
---

Index `user_id` on `instance`, `message`, `entry`, `segment_member` and `segment_start`. An erasure deletes every row of a user from each of them under the user's lock, and none of these tables led with the user: each delete scanned the whole table, for as long as the lock was held. Hosts regenerate the drizzle file (`workflow-ui generate`) and let drizzle-kit write the migration; `checkSchema` does not require the new indexes, so a deploy before the migration still serves.
