---
'@shware/workflow-ui': patch
---

Ship `@fontsource-variable/inter` as a dependency: the studio's stylesheet imports it and Vite compiles that stylesheet in the host project, so it was unresolved under strict installs. Drop two unused devtools dev dependencies.
