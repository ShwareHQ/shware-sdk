---
'@shware/workflow-ui': patch
---

The studio's Vite server disables env files with `envDir: false` instead of the deprecated `envFile` option, so it no longer prints a deprecation warning on start.
