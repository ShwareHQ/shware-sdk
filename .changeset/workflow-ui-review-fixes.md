---
'@shware/workflow-ui': patch
---

Two Studio fixes: the preview-props editor no longer remounts (losing focus and caret) when the typed text first becomes valid JSON — its text is owned by the editor once edited and it is keyed by template only — and the project refreshes on changes to every file the last load actually evaluated (the config and its transitive imports in Vite's SSR graph, watched explicitly), so a `--config` outside the working directory or a shared module it imports no longer leaves the canvas on stale IR; the config's own workspace is also added to `server.fs.allow`.
