---
'@shware/purchase': minor
---

`AppStoreNotificationHandler.process` acknowledges a notification type with no registered handler (logged with `console.warn`) instead of throwing, so a host answers 200 rather than 5xx and Apple stops retrying it.
