---
'@shware/analytics': patch
---

Let a `ThirdPartyTracker` be an `async` function again: 12.1 typed its return as `void | boolean`, which rejected the SDK's own `sendFirebaseEvent` (and any tracker returning a promise). The promise is not awaited and counts as a handled call.
