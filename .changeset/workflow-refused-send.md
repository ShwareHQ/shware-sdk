---
'@shware/workflow': minor
---

A send the provider refuses for good no longer fails the journey. When a sender throws an error no retry can fix (a `PermanentError`, or a transport error with `retryable: false`), the copy is settled undelivered under the refusal's reason and the journey goes on: the user's other devices still get the push and the later steps still run. Before, one device registered under another Firebase project (`SENDER_ID_MISMATCH`), an APNs `DeviceTokenNotForTopic`, a push payload over the limit or an SES `MessageRejected` failed the whole instance.

The reason is the provider's code where it gave one, `http_<status>` for a bare status, `bad_credentials` or `not_configured` for a malformed or missing secret, and `refused` otherwise. `PermanentError` takes a `reason` option, `SesSendError` and `CloudflareEmailError` carry a `reason`, and `refusalReason` is exported from `@shware/workflow/engine`; a transport of your own names it with a `reason` string on the error.

A deployment-wide mistake (a wrong APNs key, a revoked service account) is settled the same way: no instance fails for it, so watch the undelivered reasons in the delivery report. A template refusing its props still fails the step.
