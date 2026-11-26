---
'@shware/workflow': patch
'@shware/workflow-ui': patch
---

Fixes from the workflow review, first batch.

`@shware/workflow`

- A host with no `API_TOKEN` and no `authorize` now runs open only in a mode named for it: `development`, `test`, or a mode with a `runtime` entry in the config. Any other `ENVIRONMENT` (`prod`, `Production`, an undeclared `staging`) is refused with a 503 like production, instead of serving every route open. **If you run an undeclared mode open on purpose, give it a `runtime` entry or set `API_TOKEN`.**
- `POST /t/p/<id>` and `POST /t/d/<id>` take a push copy's id only. An email's id — present in every link of the email — no longer records a human open or hands the host a `pushOpened` event for its recipient.
- A goal on the trigger's own event (a repeat purchase) no longer converts at entry on the very event that started the instance.
- `waitUntil` no longer counts an event that happened after its deadline when the check runs late.
- Instance ids sanitize the workflow id: a `.` or `/` in it made Cloudflare refuse every start (`instance.invalid_id`).
- VAPID tokens expire after 18 hours instead of exactly 24, so a host clock that runs fast is not refused by the push service.
- AWS: `findExecution` asks by function and name only; Lambda refuses a name filter combined with a qualifier.

`@shware/workflow-ui`

- `plan` reads the pinned journeys unless the entry ledger itself is missing; any other missing table used to report "nothing is pinned" and a safe deploy.
- The CLI loads `plan` on demand, so the studio, `generate` and `--help` work without the optional `postgres` peer.
- A `waitUntil` card says whether its timeout exits or continues.
