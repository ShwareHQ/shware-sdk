# @shware/utils

## 1.8.0

### Minor Changes

- 2b8ec66: Fix Stripe minor-unit conversion: three-decimal currencies (BHD, JOD, KWD, OMR, TND) now divide by 1000 instead of 100, and UGX is treated as two-decimal like ISK, matching how the Stripe API represents its amounts. `@shware/utils` exports the new `THREE_DECIMAL_CURRENCIES`; `@shware/purchase`'s `minorUnits` / `price` and `@shware/analytics`' `stripeMinorUnits` now share its single table.

## 1.7.0

### Minor Changes

- 91b6d3b: Expose usePrevious from @shware/utils with its effect-updated previous-render snapshot behavior, public type declarations, and targeted React refs exemption.

### Patch Changes

- 91b6d3b: Preserve the synchronous render-time behavior of useDebouncedCallback and useLatestRef while adding precise lint compatibility annotations and documenting their existing concurrent-render boundary.
- 91b6d3b: Document and preserve hydration-safe persisted hint eligibility and per-mount dismissal sessions.

## 1.6.3

### Patch Changes

- a9ed686: Upgrade dependencies to their latest versions.

## 1.6.2

### Patch Changes

- 0d439e3: Upgrade dependencies and peer dependencies to their latest versions.

## 1.6.1

### Patch Changes

- Dependency refresh. Only development dependencies moved — `@types/node` 26.3.0 and `vitest` 4.1.11 — so the published output is identical to 1.6.0.

## 1.6.0

### Minor Changes

- `fetch` now runs `retryCondition` for every response, successful ones included, and awaits it, so APIs that report failures in the body of a 200 can be retried. The callback receives a clone, leaving the body of the returned response unread. Errors thrown by the callback now propagate instead of being retried as if they were network failures.

## 1.5.2

### Patch Changes

- Type-aware lint fixes (void-consistent debounce timer callbacks, `??=` in `once`); no behavior change.

## 1.5.1

### Patch Changes

- update visitor schema

## 1.5.0

### Minor Changes

- update deps, ts 7, tsdown

## 1.4.5

### Patch Changes

- update deps, fix oxlint, add page_referrer

## 1.4.4

### Patch Changes

- update deps

## 1.4.3

### Patch Changes

- update deps

## 1.4.2

### Patch Changes

- add waitForRequestIdleCallback

## 1.4.1

### Patch Changes

- update deps

## 1.4.0

### Minor Changes

- add react hooks

## 1.3.0

### Minor Changes

- update deps

## 1.2.1

### Patch Changes

- update deps

## 1.2.0

### Minor Changes

- update deps

## 1.1.5

### Patch Changes

- add useExponentialHint

## 1.1.4

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint

## 1.1.3

### Patch Changes

- update deps

## 1.1.2

### Patch Changes

- add tests

## 1.1.1

### Patch Changes

- update deps

## 1.1.0

### Minor Changes

- add chunk & debounce, add throttle options

## 1.0.1

### Patch Changes

- add tests

## 1.0.0

### Major Changes

- add deps

## 0.1.3

### Patch Changes

- update deps

## 0.1.2

### Patch Changes

- update deps

## 0.1.1

### Patch Changes

- global -> globalThis

## 0.1.0

### Minor Changes

- add utils

## 0.0.2

### Patch Changes

- add fetch utils
