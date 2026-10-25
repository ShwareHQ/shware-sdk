---
'@shware/analytics': patch
---

`trackOnce` no longer marks a key as sent when its event left by beacon (`sendPendingEvents`): a beacon may be dropped, so the next call for the key sends the event again under the same id and without pixels; `onSucceed` now receives `beacon: true` for beacon-settled events.
