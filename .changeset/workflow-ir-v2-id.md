---
'@shware/workflow': minor
---

IR v2: a workflow's and a segment's identity is `id` (it was `name`, which read like a label; the human label stays `meta.name`). `WorkflowIR.id`, `SegmentIR.id`, the plan's `WorkflowChange.id` / `ResourceChange.id`, `JourneyParams.workflowId`, the store's `listSegments()` rows and the `segment` table's `id` column (D1 `segments.id`). Every contentHash moves, so every workflow redeploys as a new version; IR v1 bundles and stored IRs are not read.
