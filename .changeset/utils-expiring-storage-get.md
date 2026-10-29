---
'@shware/utils': patch
---

`expiringStorage.getItem` returns `null` instead of throwing when `localStorage` is undefined (SSR) or blocked, like `setItem` and `removeItem`.
