---
'@shware/workflow': major
---

Add visitors: journeys can reach someone before sign-in through `visitorId`, for workflows that opt in with `trigger.event(e.x, { visitors: true })`. Naming `userId` and `visitorId` together moves the visitor's events, profile, devices, opt-outs and journeys to the user, once. `registerDevice` now takes one object with `deviceId`, `userId` and `visitorId`, and no `ts`; each device row holds only its current owner. Migrate: `device` gains `device_id`, `visitor_id`, `created_at` and `updated_at` and loses `ts`, `trigger` gains `visitors`, and there is a new `visitor_link` table.
