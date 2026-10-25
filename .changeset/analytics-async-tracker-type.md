---
'@shware/analytics': minor
---

`sendFirebaseEvent` is synchronous (its `logEvent` call was already fire-and-forget), so it satisfies the `void | boolean` return of `ThirdPartyTracker` that 12.1 introduced and can be passed to `thirdPartyTrackers` without a wrapper. Its return type changes from `Promise<void>` to `void`; `await`ing it still compiles.
