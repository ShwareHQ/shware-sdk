---
'@shware/utils': patch
---

`TokenBucket.removeTokens` waits for the configured `interval` (`minute`, `hour`, `day`) instead of waking every second, and the refill timer is `unref()`ed so it no longer keeps a Node process alive.
