---
'@shware/workflow': minor
'@shware/workflow-ui': patch
---

`trigger.date` runs, and takes a `filter`.

`@shware/workflow`

- **`trigger.date(at, { filter })` starts a journey, once, for every known user the filter holds for when the time comes.** `trigger.date('2026-11-27 09:00:00', { filter: purchaser })` is how to send to an audience at a time: each user is asked at that moment, so long-standing members of a segment enter like recent ones (unlike `trigger.enters`, which waits for someone to become one). Without a filter every known user enters; visitors do not. The filter is checked before an instance exists, so a user it turns away has not entered. `at` is `'YYYY-MM-DD HH:mm:ss'` in UTC and is now validated: anything else, or a date the calendar lacks, throws when the workflow is built.
- **The scheduled sweep does the starting**, 500 users a page, with its place kept in the store: a sweep spends about 25 seconds on date triggers and the next carries on, and one that is cut off loses nobody and repeats nobody (the occurrence in the entry ledger is the trigger's time). The send therefore begins at the first sweep at or after the time, and a large audience takes several sweeps. The sweep's result (`POST /segments/sweep`, `worker.sweep`) gains `dates`: what it did for each date trigger. On AWS each page is a durable step (`sweep:date:<n>`).
- **A time runs once.** The run is identified by the workflow and the time, recorded at the first deploy that carries it: redeploying does not repeat it, a deploy landing just after the time does not cancel it, and another time is another run under the workflow's `reentry` policy. A time already past at that first deploy is not run, nor is one no sweep began within a day of its time.
- **What changes for you: a workflow on `trigger.date` used to deploy and never start** (`deployBundle` listed it in `unrouted`). One whose time is still ahead when this version deploys will now fire, to every known user unless it has a filter. Check the date triggers you have. `unrouted` now lists webhook triggers only.
- **Migration required:** two new tables, `date_trigger` and `date_run` — regenerate the drizzle file (`workflow-ui generate`) and run the migration before the new version serves; `POST /bundle/deploy` answers 503 without them.
- `JourneyStore` gains `dueDateTriggers`, `listDateCandidates` and `advanceDateRun`. `@shware/workflow/cloudflare` exports `sweepDateTriggers`, `fanOutDatePage`, `DATE_TRIGGER_GRACE_MS` and `DATE_FANOUT_BUDGET_MS`.

`@shware/workflow-ui`

- The canvas marks a date trigger that has a filter.
