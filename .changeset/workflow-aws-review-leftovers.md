---
'@shware/workflow': minor
---

Close the remaining items from the AWS adapter review.

- A host whose workflows send email but that has no `email` transport (nor a `messages` override) now fails when `journeyWorker` or `journeyLambda` is created, naming the workflows. Before, it failed only at its first email.
- One rule decides which step failures are not retried (`isRetryable` in `@shware/workflow/engine`), shared by the Cloudflare runner and the AWS step. A provider rejecting the request itself is no longer retried: `SesSendError` and `CloudflareEmailError` carry `retryable: false` for a 4xx answer other than 408 and 429. Throttling and server errors are still retried.
- `journeyLambda({ executionTimeoutMs })`: a workflow that can outlive the function's durable `ExecutionTimeout` fails the handler's creation, instead of being stopped by the platform midway. `longestJourneyMs(ir)` computes the bound from the IR: delays at their longest, waits to their timeout, a time window as a week, the longest arm, and at least the goal's window.
