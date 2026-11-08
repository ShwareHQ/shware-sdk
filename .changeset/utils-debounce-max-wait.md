---
'@shware/utils': patch
---

Fix `debounce` with `maxWait`: a continuous stream of calls invoked the function only once instead of at least every `maxWait`. It now tracks the time of the last invocation like lodash and invokes once `maxWait` has elapsed since it, both when the timer fires and when a new call arrives; `flush` also clears the pending timer so it cannot invoke a second time.
