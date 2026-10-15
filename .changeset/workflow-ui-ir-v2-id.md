---
'@shware/workflow-ui': minor
---

Follows IR v2: `WorkflowReport.id` and `SegmentReport.id` replace `name`, the workflow and segment pages live at `/workflows/$id` and `/segments/$id`, and the Postgres stats read the `segment` table's `id` column.
