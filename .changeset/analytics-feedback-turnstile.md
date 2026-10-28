---
'@shware/analytics': major
---

`createFeedbackSchema` requires `turnstileToken` (1 to 2048 characters, the field `@shware/security`'s email-code request carries), so a host validating `POST /feedback` with it now rejects a body without one and can verify the Cloudflare Turnstile challenge before storing the feedback. Every client calling `sendFeedback` must render a Turnstile widget and pass its token, resetting the widget after each submit since the token is single-use, and hosts must verify it against Cloudflare's `siteverify` before storing the row.
