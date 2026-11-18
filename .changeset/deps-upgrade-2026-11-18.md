---
'@shware/analytics': patch
'@shware/http': patch
'@shware/purchase': patch
'@shware/security': patch
'@shware/utils': patch
'@shware/workflow': patch
'@shware/workflow-ui': patch
---

Update dependencies to their latest versions (`@posthog/types` 1.425, `cookie` 2.0.2, `jose` 6.2.17, `@slack/types` 3.3, `discord-api-types` 0.38.59, the bundled `bowser` 2.15, and the dev toolchain: vitest 5.1, tsdown 0.23.7, oxlint 1.94, oxfmt 0.79, pnpm 12). `path-to-regexp` stays on 8.x in `@shware/security`: 9.0 is ESM-only and moves the greedy match in multi-parameter segments, which would change what `param()` returns.
