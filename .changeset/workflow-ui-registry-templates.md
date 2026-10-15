---
'@shware/workflow-ui': patch
---

The Templates page lists every registered template, referenced by a workflow or not yet — the IR only adds where each is used — so a template can be previewed before a flow uses it; templates a workflow references without registering still show as missing. An unknown key in the URL says so instead of falling back to the first template, and the preview-props editor starts from the props the preview renders with. A registry can also be exported as one `{ email, push }` object (`export const registry = {...}` beside `t = templates(registry)`): the studio imports each channel as a property of that export, so a small project needs no per-channel index modules. The missing-registry hints name the `email` / `push` registries.
