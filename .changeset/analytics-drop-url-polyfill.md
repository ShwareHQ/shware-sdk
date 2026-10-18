---
'@shware/analytics': patch
---

`@shware/analytics/native` now uses the global `URLSearchParams` that Expo SDK 57+ installs, and `react-native-url-polyfill` is no longer an optional peer. Apps can remove `react-native-url-polyfill` from their dependencies unless their own code imports it.
