---
'@shware/workflow-ui': patch
---

The Studio pre-bundles `@react-email/render` and `react-dom/server` and scans the project config for dependencies at startup, so the first email preview no longer fails with "Failed to fetch dynamically imported module" (Vite's outdated-optimize-dep 504) while Vite re-optimizes.
