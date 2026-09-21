---
'@shware/workflow': minor
---

Push notifications: `@shware/workflow/push` (push registry renderer with `{prop}` placeholders, the studio's PushModule shape) and `@shware/workflow/fcm` (`FcmPushSender`: FCM HTTP v1 from a service account, OAuth token minted with WebCrypto, dead tokens reported through `onUnregistered` instead of retried). `routeByChannel({ email, push })` fans one runner outlet out per channel. The engine addresses pushes to the profile's `push_token`.
