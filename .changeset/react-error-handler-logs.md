---
'@shware/analytics': patch
---

`setupReactErrorHandler()` without a callback now logs the error with `console.error`, as React does while no handler is set; before, setting it silenced React's console output.
