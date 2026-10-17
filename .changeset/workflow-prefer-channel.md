---
'@shware/workflow': minor
---

Add `.prefer([pushTemplate, emailTemplate], props, { label })` to the flow builder: one message on the first reachable channel, compiled to the same branch (IR, ids and hash) as writing `branch([reachable(first), …], second)` by hand, with both templates required to declare the same props type.
