---
'@shware/security': minor
---

`REQUEST_REASONS` and `RequestReason` are exported: the `ErrorInfo.reason` values the SDK answers a malformed, too-soon or unauthenticated request with (`INVALID_ARGUMENT`, `INVALID_ATTRIBUTES`, `INVALID_CODE_VERIFIER`, `INVALID_CONTENT_TYPE`, `INVALID_JSON`, `TURNSTILE_VERIFICATION_FAILED`, `UNAUTHENTICATED`, `VERIFICATION_CODE_RESEND_TOO_SOON`, `EMAIL_DELIVERY_FAILED`), alongside `AUTHENTICATION_REASONS` for the 403 ones, so a client's message table can cover every reason. The throw sites are typed against the list, so a new reason cannot be added without it.
