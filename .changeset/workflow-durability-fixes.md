---
'@shware/workflow': major
---

Close the gaps a design review found where journeys were silently lost or duplicated. Regenerate the drizzle schema (`workflow-ui generate`) and migrate Postgres before deploying: the `entry` table gains a `claimed_at` column and an index on `admitted_at`, and the deploy check refuses to run until they exist.

- **A start lost between the entry and the create no longer bars the user for good (Cloudflare).** The entry commits before the platform creates the instance; a Worker cut off between the two used to leave a `running` entry nothing would ever admit. A retry of the same event now creates the missing instance (a create refused as a duplicate counts as done, never as a failure to roll back), and the sweep's maintenance marks an entry left unadmitted for 15 minutes, with no instance behind it, as `failed` so the next trigger re-enters. A segment-entry start is crossed off only once its instance is known to exist.
- **A user without a usable email address no longer fails the journey.** `EmailSender` settles the copy undelivered (`no_recipient`, `invalid_recipient`) instead of throwing a retryable error that ended the instance as `failed`; the rest of the journey runs, as it does for a push with no device.
- **A replayed send step skips a copy it already settled.** The observer gains `messageSettled`; the reporting observer answers it from the `message` row, so an instance that crashed after the send and its report, before the checkpoint, does not send again.
- **A cohort without a `key` buckets per workflow.** The fallback hash input is now `userId:workflowId:nodeId`; it was `userId:nodeId`, which put a user in the same arm of every unrelated cohort at the same position. In-flight cohorts without a `key` re-bucket new evaluations; set an explicit `key` to keep an assignment stable.
- **A forced `POST /bundle/deploy` records the version that served it**, so a newer version still serving re-applies its own bundle instead of skipping it because the live row named it.
- **`performed` stops counting once its threshold is met.** The fact source takes an `atLeast` hint; a plain count stops at it in SQL, and a `where` filter reads payloads a page at a time (`pageEventPayloads` replaces `listEventPayloads`) instead of loading a user's whole history on every evaluation.
