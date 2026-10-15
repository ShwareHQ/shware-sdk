---
'@shware/workflow': minor
---

Browser push: `@shware/workflow/webpush` sends standard Web Push (VAPID, `aes128gcm`) to Chrome, Edge, Firefox and Safari 16+ with nothing but WebCrypto, and `generateVapidKeys()` makes the key pair. A `web` device is the browser's `PushSubscription` JSON, registered like an app token (`registerDevice(userId, { token, platform: 'web' })`); `defineConfig({ webPush: { subject } })` turns the channel on with `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` from the environment. Push templates may give a `url` (where a tap leads; APNs and FCM carry it too).
