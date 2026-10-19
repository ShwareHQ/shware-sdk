---
'@shware/analytics': patch
---

Track the previous queued page or screen view inside the sending effect so React Compiler memoization preserves Activity restoration history. Strict Mode effect replay now names the first queued view as its predecessor and flushes its engagement time instead of repeating an empty predecessor.
