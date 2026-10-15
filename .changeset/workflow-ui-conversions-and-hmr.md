---
'@shware/workflow-ui': patch
---

Postgres stats count conversions by `converted_at` (falling back to status `goal` for older rows) and skip instances that never reached a node in the node counts; metric rows are keyed by template too, and a stats HMR update invalidates the cached queries.
