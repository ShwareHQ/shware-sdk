---
'@shware/workflow': minor
---

A sweep that runs out of time is carried on by the next.

- **The segment sweep keeps its place in the store.** The pass over every user used to live in the call that ran it: on Cloudflare a sweep cut off by the scheduled handler's time limit began again from the first user at the next cron, and what ends a pass — the seeding of new or changed segments, the recorded sizes — waited for one sweep to get through everyone that was left. The pass is now a row (`sweep_pass`: its cursor, and the segments that were being seeded when it began). A sweep spends a bounded time on it (`SWEEP_BUDGET_MS`, about 30 seconds, as the date triggers have), saves its place after every page, and the next sweep goes on from there. The pass ends once, however many sweeps it took.
- **`SweepResult` gains `finished`**: whether the pass has been through every user. `sizes` is empty for a sweep that left it unfinished (the sizes are recorded when a pass ends).
- **One implementation for every host.** `sweepSegmentPass` is the pass; `sweepSegments(env, store, now, budgetMs)` runs maintenance, the date triggers and the pass. The AWS host no longer carries its own copy of the loop: each of its `sweep:page:<n>` durable steps runs one page of the same pass, and the steps `sweep:seeding`, `sweep:seeded` and `sweep:snapshot` are gone (the pass ends inside its last page).
- **Two sweeps at once** (an overlap, `POST /segments/sweep` during a cron) both do their page; the place moves only from where it was read, so the one that comes back late stops without ending the pass.
- **Migration required:** one new table, `sweep_pass` — regenerate the drizzle file (`workflow-ui generate`) and run the migration before the new version serves; `POST /bundle/deploy` answers 503 without it.
- `JourneyStore` gains `openSweepPass`, `advanceSweepPass` and `finishSweepPass`. `@shware/workflow/cloudflare` exports `sweepSegmentPass` and `SWEEP_BUDGET_MS`.
