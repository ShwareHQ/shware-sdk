---
'@shware/workflow': minor
---

Breaking: `workflow()` takes one object, `workflow({ id, trigger, goal?, exitWhen?, name?, description? })`, in place of `workflow(name, options)`, matching `segment({ id, ... })`. `id` is the wire identity (still `WorkflowIR.name`, so compiled bundles and hashes are unchanged); `WorkflowOptions` is renamed `WorkflowDefinition`. The unused `tags` and `owner` metadata are removed from the definition and from `MetaIR` (stored bundles that carry them still parse; the fields are dropped).
