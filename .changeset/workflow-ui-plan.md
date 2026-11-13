---
'@shware/workflow-ui': minor
---

`workflow-ui plan --database-url <url>` (or `DATABASE_URL`): the deploy-time check run before the deploy. It compiles the project, reads which workflow versions journeys are still running on, and holds the bundle and this code's templates against them (`checkInFlight`); it prints the pinned versions, the migrations the database still lacks and what would break, and exits non-zero on a problem. On Cloudflare a new version's code serves the moment it is published, so this belongs in CI ahead of `wrangler deploy`.
