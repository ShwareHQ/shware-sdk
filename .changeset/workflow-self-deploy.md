---
'@shware/workflow': minor
---

A new Worker version makes its compiled bundle live by itself: with Cloudflare's version metadata binding (`CF_VERSION_METADATA`) and the Postgres store, the first request or cron run of each isolate applies the bundle when the live one came from an older version, guarded in the same transaction so an old version still serving during a rollout cannot put its routes back. `wrangler deploy` is the whole deploy; `POST /bundle/deploy` stays as the forced apply (after a rollback, and on D1). Adds the `deployment` table (regenerate the drizzle schema and migrate), `JourneyStore.liveBundleVersion` / `replaceRoutesIfNewer`, a `version` argument to `deployBundle` and `applied` on its result.
