---
'@shware/workflow': patch
---

One device's refusal no longer ends the journey.

A push answer that is about a single device used to be a `PermanentError`: the step failed without a retry, the instance failed with it, the user's other devices were not sent to and nothing later in the workflow ran — and since the device was kept, every later push journey for that user ended the same way. A development build's token registered against the production backend was enough.

These now settle the copy as undelivered, with the reason in the delivery report, and the journey goes on; the device is kept, as before:

- APNs `DeviceTokenNotForTopic` (a token of another app), beside `BadDeviceToken`.
- FCM `SENDER_ID_MISMATCH` (a token of another Firebase project), beside `INVALID_ARGUMENT`.
- Web Push 400, 401, 403, 413 and any other non-retryable 4xx, as `Refused<status>`, logged as an error. A push service names no finer reason, so a subscription made under a rotated VAPID key cannot be told from a wrong key.

What changes for you: if the deployment itself is misconfigured (the wrong APNs environment or topic, another project's service account, a wrong VAPID key), these answers come back for every device, and they now show up as undelivered copies with that reason instead of failed instances. Configuration errors that no device could get past (`BadTopic`, `InvalidProviderToken`, `THIRD_PARTY_AUTH_ERROR`, …) still fail the step.
