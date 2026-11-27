---
'@shware/workflow': minor
---

A send the provider never answered is no longer sent again.

- **What was wrong.** Delivery is at most once, but every thrown send was read as "refused for sure": the claim was released and the step retried. A request that left and got no answer back (the connection dropped, the fetch timed out) may have been taken by the provider, and SES, Cloudflare Email, FCM and the Slack and Discord webhooks do not de-duplicate, so the retry could deliver a second copy.
- **Now.** Those senders throw an `UnansweredSendError` when the request that hands the message over gets no answer. The engine keeps the copy's claim, settles it undelivered with the reason `no_answer`, and goes on to the next step; the step does not retry. A template with `redelivery: 'resend'` is retried as before. A `fetch` that fails does not say whether the request left, so a connection that could not be opened is treated the same way: **such a copy used to be retried and is now lost**, which is the side of the trade at-most-once already chose.
- **Unchanged.** A provider's refusal (4xx, 429, 5xx) and anything that fails before the request (rendering, credentials, a token exchange) still release the claim and retry. APNs and Web Push are retried on a network error as before, since a repeat collapses on the device, and so is `WebhookMessageSender`, whose receiver de-duplicates on the idempotency key. The Cloudflare `send_email` binding is not covered: what it throws is still taken as a refusal.
- **A 2xx whose body cannot be read is a delivery.** SES read the body before looking at the status, and the Cloudflare REST transport treated an unreadable 200 as a retryable failure; both sent the email again. The status is now the answer, and only the provider's message id is lost.
- **The uncertain copies are in the report.** A copy claimed by a run that died before settling was skipped on replay with only a log line; it is now settled undelivered as `unconfirmed`. With `no_answer`, what at-most-once cost can be counted from `undelivered_reason`.
- A delivery reported after one of those two reasons was written (a replay overtaking a slow send) replaces it, and an undelivered reason is no longer written over a recorded delivery. No schema change.
- `@shware/workflow/engine` exports `UnansweredSendError`, `isUnanswered` and `awaitAnswer`. A transport of your own marks the case by throwing an error with `unanswered: true`.
