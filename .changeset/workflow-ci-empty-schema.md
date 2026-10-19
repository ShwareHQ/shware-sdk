---
'@shware/workflow': patch
---

Stabilize the worker deployment failure regression test by using an unmigrated schema instead of starting a second database within the test timeout.
