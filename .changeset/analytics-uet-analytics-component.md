---
'@shware/analytics': minor
---

The `Analytics` component of every framework entry (`tanstack`, `next`, `react-router`) takes a `uetTagId` and inlines Microsoft's UET snippet (bat.js, `enableAutoSpaTracking: true`), the way it already inlines the other vendors' tags. The tag owns page loads; `sendUETEvent` forwards everything else.
