---
'@shware/workflow': minor
---

`.use(fragment)` splices a `flow(...)` or a callback into the chain while the workflow is defined: no new IR node, ids assigned over the whole workflow as if written inline (same executable IR and hash), one copy per use so a fragment is reusable across places and workflows. Sub-flow callbacks that return a Promise are now refused (they would add nodes after ids were assigned).
