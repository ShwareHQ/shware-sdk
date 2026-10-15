---
'@shware/workflow': minor
---

`forgetUser` is a recoverable erasure: the request is recorded (`erasure` table), every running instance is stopped, and only then is the data erased, the request with it. An instance that will not stop leaves everything in place and answers `erased: false`; the scheduled sweep retries pending erasures. A failure to terminate is no longer taken for an instance that is already gone. Store API: `requestErasure`, `pendingErasures`, `runningInstances`, and `forgetUser` now returns nothing.
