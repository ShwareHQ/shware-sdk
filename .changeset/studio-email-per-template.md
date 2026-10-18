---
'@shware/workflow-ui': major
---

The studio follows `@shware/workflow`'s per-template email metadata: a template's detail shows its own sender, reply-to and resolved unsubscribe link, previews render inside the same `EmailProvider` the Worker's renderer uses (so a layout's `useEmailContext()` works), and Settings shows the config's `email` (default unsubscribe link, quick-click window) instead of a global envelope. `ResolvedStudioConfig.emailDefaults` is replaced by `email`, and `useEmailPreview` takes the config's `email`.
