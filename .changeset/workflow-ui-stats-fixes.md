---
'@shware/workflow-ui': patch
---

Postgres stats: one pool per connection string across dev-server reloads with a 20s idle timeout (it used to leak connections), opens and clicks only count for copies that reached the recipient, and day ranges follow local calendar days across DST changes.
