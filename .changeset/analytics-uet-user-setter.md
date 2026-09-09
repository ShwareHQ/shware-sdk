---
'@shware/analytics': minor
---

`setUETUser` is the setter itself, not a factory: register it as `thirdPartyUserSetters: [setUETUser]`, not `[setUETUser()]`.

It had copied the `setFBUser(pixelId)` shape, but UET has nothing to bind first — the snippet ties the queue to its tag — so the extra call was noise, and unlike `setGAUser`, which it now matches. The old form was published in 8.5.0 earlier the same day; any `setUETUser()` call must drop the parentheses.
