---
'@shware/workflow': major
---

Close the correctness gaps the 4.0 review found in the durable runtime, the store and the host. Postgres hosts must regenerate the drizzle schema (`workflow-ui generate`) and migrate before deploying; D1 databases must be recreated; Workers drop the `WORKFLOW_KV` binding.

- **Waits.** A `waitUntil` or goal tail that genuinely timed out after the instance was evicted (any `wrangler deploy`) no longer ends the journey as `failed`: the timeout verdict is taken against the deadline the interpreter checkpointed, not a clock read on the live attempt. `EngineStep.waitForWake(name, { timeoutMs, deadlineMs })` replaces `waitForWake(name, timeoutMs)`, and `sleepUntil` is gone from the port — the interpreter checkpoints the remaining time and sleeps, so a `timeWindow` replayed after its target no longer throws. When a wait exhausts its wake budget it now sleeps to its deadline and checks once more, instead of being read as a timeout.
- **Non-retryable errors on Cloudflare** keep the `NonRetryableError` name the engine recognises, so a template or contract refusal, or a provider's 4xx, ends the step at once instead of retrying five times.
- **Scoped profile wakes.** A property condition subscribes to `$profile_updated:<property>` and `/identify` wakes only the properties it patched; an unsubscribe wakes waits on the email address, so `exitWhen: not(reachable('email'))` takes effect at once. The unscoped `$profile_updated` is still fired for instances that subscribed before 4.0.
- **Event ids are per user.** The unique key on the event log is `(user_id, event_id)`; two users reusing one id no longer lose an event.
- **Erasure refuses writes.** `/events`, `/identify` and `/devices` answer 410 for a user whose `/users/forget` has not finished, so nothing re-enters a journey between the stop and the erase. Suppressions (unsubscribes) survive an erasure.
- **Input checks.** A body that is not JSON answers 400; `ts` must be a non-negative integer no later than five minutes ahead; `/identify` values must be scalars or null. The host has an error boundary: an unexpected failure answers 500 instead of escaping `fetch`.
- **Production needs `API_TOKEN`.** A host whose `ENVIRONMENT` resolves to `production` answers 503 to everything but `/health` and `/t/...` until it is set; the bearer is compared in constant time.
- **D1 keeps the IR in a `workflow_ir` table**, not in KV: an instance started in another colo right after a deploy always finds its IR. `D1JourneyStore` takes only the database; `JourneyEnv.WORKFLOW_KV` and `KVNamespaceLike` are removed.
- **The deploy check verifies unique indexes**, not only columns, so a database missing an `ON CONFLICT` target is refused at deploy rather than at the first event.
- **AWS.** A `$workflow.run` input must match a start recorded in the execution registry, so a direct `Invoke` cannot run an arbitrary journey. The sweep runs one durable step per page of users and resumes after an invocation timeout instead of starting over. A failed instance drops its wake subscriptions.
- **Actions no longer carry a `codeHash`.** It hashed `handler.toString()`, which every bundler prints differently, so each toolchain produced a "new version" of every workflow with a `.run()`. `action(name, handler)` is unchanged; `RegisteredAction.codeHash` is optional and the version policy only compares when both sides have one. `plan()` lists actions as added or removed.
- **`plan()` keys templates by channel and id**, so an email and a push sharing an id no longer report `changed` forever.
- **Compile refuses** a `.sendEvent()` carrying literal fields a strict event does not declare, `timeWindow({ days: [] })`, `performed({ count: 0 })`, zero durations and segment reference cycles.
- **The `scheduled` handler awaits the sweep** instead of handing it to `waitUntil`, so a long sweep is not cut off silently.
