---
'@shware/workflow': minor
---

Add `webPush.openedEvent`: a notification tap a browser reports to `/t/p` is also ingested as that contract event (`{ message_id }`, one per copy), so conditions such as `performed(e.push_opened)` see web opens as they see the app's.
