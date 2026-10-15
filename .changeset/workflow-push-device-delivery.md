---
'@shware/workflow': minor
---

Pushes can be counted when the device has them: with reporting and `WORKFLOW_ORIGIN`, a push carries `delivered_url` and `opened_url` beside `message_id`, and the Worker records `POST /t/d/<message>` as the copy's device delivery (`message.device_delivered_at`) and `POST /t/p/<message>` as a person's open — for clients that report on their own, such as an iOS notification service extension or a browser's service worker. An APNs push with a `delivered_url` (or an image) is sent `mutable-content`, so the extension runs.
