---
'@shware/utils': patch
---

`waitForRequestIdleCallback` removes its `abort` listener from the signal once it resolves, so a long-lived signal no longer accumulates listeners.
