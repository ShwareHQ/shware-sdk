# @shware/skills

## 0.2.0

### Minor Changes

- 0cb1489: Adds `api-error-handling` (raising errors with `Status` / `Details`, declaring `ErrorReason`, `zValidator`, mapping third-party errors, and reading errors on the client with `isErrorReason`, `getFieldViolations` and a global handler that skips `handledReasons`) and `subscription-purchase` (entitlement through `AVAILABLE_STATUSES`, catalog changes that keep old prices, checkout with `allowedOrigins`, and store notifications that write current state idempotently). `user-event-tracking` now covers `identify`, `reset` and `trackOnce`.

## 0.1.0

### Minor Changes

- 3da1e46: New package: agent skills for the SDK, shipped in `skills/` for skills-npm to link into `.agents/skills`. It starts with `cursor-based-pagination-api` (`@shware/http` cursors and TanStack Query infinite queries) and `user-event-tracking` (`@shware/analytics` events, including declaring custom events in `CustomEventProperties` and turning on `strict` so only declared and GA4 standard events compile).
