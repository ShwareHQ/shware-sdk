---
'@shware/workflow-ui': minor
---

Breaking: `workflow.stats.ts` runs on the studio's dev server (Node) instead of in the browser, so it can query the project's database or API with credentials from the environment. The page calls each defined `StatsSource` method over `POST /__studio/stats/<method>` (same-origin only, JSON in and out); a throwing method answers 500 with its message.
