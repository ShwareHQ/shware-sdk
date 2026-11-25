---
'@shware/skills': minor
---

Adds `api-error-handling` (raising errors with `Status` / `Details`, declaring `ErrorReason`, `zValidator`, mapping third-party errors, and reading errors on the client with `isErrorReason`, `getFieldViolations` and a global handler that skips `handledReasons`) and `subscription-purchase` (entitlement through `AVAILABLE_STATUSES`, catalog changes that keep old prices, checkout with `allowedOrigins`, and store notifications that write current state idempotently). `user-event-tracking` now covers `identify`, `reset` and `trackOnce`.
