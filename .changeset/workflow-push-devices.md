---
'@shware/workflow': minor
---

Push devices live in the engine's store: the app registers each token with `JourneyClient.registerDevice(userId, { token, platform })` (`POST /devices`) and forgets one with `removeDevice(token)` (`POST /devices/remove`). A token belongs to the last user it was registered for, and tokens APNs / FCM report as gone are removed. A push node sends one copy per device (idempotency key per token), or only the most recent with `.push(t, props, { devices: 'latest' })`; a user without a device is skipped. `reachable('push' | 'email' | …)` branches and waits on reachability, woken by every registration and removal. Push senders are now built on their first message, so a missing APNs key no longer fails email-only journeys. The profile's `push_token` / `push_platform` convention is gone.
