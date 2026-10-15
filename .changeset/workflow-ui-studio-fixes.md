---
'@shware/workflow-ui': patch
---

Studio fixes: a JSON error in the preview-props editor is dropped when switching templates, Discord/Slack previews only treat `_`, `*` and `~` as markers at word boundaries (so `snake_case` stays text), `schema --check` ignores formatter-only differences without collapsing real ones, and registry exports whose names are not identifiers are imported with quoted names.
