---
'@shware/http': patch
---

`cancel()` in `@shware/http/google-one-tap` is now built on a shared `AbortController` instead of a set of in-flight prompts. Internal restructuring only: behaviour and the public API are unchanged.
