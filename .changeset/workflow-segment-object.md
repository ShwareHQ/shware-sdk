---
'@shware/workflow': minor
---

Breaking: `segment()` takes one object, `segment({ id, name?, description?, condition })`, in place of `segment(name, condition, { name, description })`. `id` is the wire identity (still `SegmentIR.name`, so compiled bundles and hashes are unchanged), and `SegmentRef` exposes it as `id`; `name` and `description` are optional labels outside the hash. `SegmentDefinition` is exported.
