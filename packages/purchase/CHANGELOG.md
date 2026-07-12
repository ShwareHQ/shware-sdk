# @shware/purchase

## 4.0.0

### Major Changes

- Add Google Play subscription status mapper; replace the GooglePlaySubscriptionState const object with an array.

  BREAKING CHANGES:

  - `GooglePlaySubscriptionState` is now a type-only union derived from the new `GOOGLE_PLAY_SUBSCRIPTION_STATES` as-const array; dot access like `GooglePlaySubscriptionState.SUBSCRIPTION_STATE_ACTIVE` becomes the string literal `'SUBSCRIPTION_STATE_ACTIVE'`

  New:

  - `mapSubscriptionStatus(state)` on `@shware/purchase/google-play` maps subscriptionsv2 states to `SubscriptionStatus` (`SUBSCRIPTION_STATE_UNSPECIFIED` throws)

## 3.0.0

### Major Changes

- Replace TypeScript enums with erasable const declarations.

  BREAKING CHANGES:

  - `Platform` and `SubscriptionStatus` are now type-only unions derived from the new `PLATFORMS` and `SUBSCRIPTION_STATUSES` arrays; dot access like `SubscriptionStatus.ACTIVE` becomes the string literal `'ACTIVE'`
  - `ALL_PLATFORMS` and `ALL_SUBSCRIPTION_STATUS` are removed — use `PLATFORMS` / `SUBSCRIPTION_STATUSES` (as-const tuples, ready for `pgEnum` / `z.enum`)
  - `AVAILABLE_STATUS` is renamed to `AVAILABLE_STATUSES`
  - Google Play RTDN enums (`SubscriptionNotificationType`, `OneTimeProductNotificationType`, `VoidedPurchaseProductType`, `VoidedPurchaseRefundType`, `GooglePlaySubscriptionState`) are const objects now: dot access is unchanged, but numeric reverse lookups like `SubscriptionNotificationType[2]` no longer exist, and member-as-type positions need `typeof`

## 2.0.1

### Patch Changes

- add config method

## 2.0.0

### Major Changes

- Decouple plan and billing period in purchase configs.

  BREAKING CHANGES:

  - `StripeConfig` / `AppStoreConfig` / `GooglePlayConfig` gain a caller-defined billing period generic: `create<NS, Plan, BillingPeriod>`
  - stripe: `product(id, plan)` → `product(id, plan, billingPeriod)`; a plan+period pair may be declared on only one product chain (version prices within that chain)
  - app-store: `subscription(plan)` → `subscription(plan, billingPeriod)`; the duplicate-plan guard now keys on the plan:period pair, so one plan can ship both monthly and yearly
  - google-play: `basePlan(planId, plan, metadata?)` → `basePlan(planId, plan, billingPeriod, metadata?)`
  - new `getBillingPeriod` lookups mirroring `getPlan` on all three configs

## 1.9.0

### Minor Changes

- update deps, ts 7, tsdown

### Patch Changes

- Updated dependencies
  - @shware/utils@1.5.0

## 1.8.9

### Patch Changes

- update deps, fix oxlint, add page_referrer
- Updated dependencies
  - @shware/utils@1.4.5

## 1.8.8

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.4

## 1.8.7

### Patch Changes

- add pending checkout store

## 1.8.6

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.3

## 1.8.5

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.1

## 1.8.4

### Patch Changes

- export stripe type

## 1.8.3

### Patch Changes

- fix stripe type

## 1.8.2

### Patch Changes

- fix stripe types

## 1.8.1

### Patch Changes

- fix export types

## 1.8.0

### Minor Changes

- update stripe types

## 1.7.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.3.0

## 1.6.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.2.1

## 1.6.1

### Patch Changes

- add REFERRAL_CODE metadata key

## 1.6.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.2.0

## 1.5.12

### Patch Changes

- add Price type

## 1.5.11

### Patch Changes

- add price mapper

## 1.5.10

### Patch Changes

- add cancellationCouponId

## 1.5.9

### Patch Changes

- add resubscribeIntent field

## 1.5.8

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint
- Updated dependencies
  - @shware/utils@1.1.4

## 1.5.7

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.3

## 1.5.6

### Patch Changes

- remove priceId

## 1.5.5

### Patch Changes

- add priceID

## 1.5.4

### Patch Changes

- fix onetime credit getter

## 1.5.3

### Patch Changes

- update error message

## 1.5.2

### Patch Changes

- fix type

## 1.5.1

### Patch Changes

- add export

## 1.5.0

### Minor Changes

- add GooglePlayConfig

## 1.4.0

### Minor Changes

- add AppStoreConfig options

## 1.3.0

### Minor Changes

- add AppStoreConfig

## 1.2.0

### Minor Changes

- add types

## 1.1.0

### Minor Changes

- add options

## 1.0.0

### Major Changes

- add stripe config

## 0.2.8

### Patch Changes

- update deps

## 0.2.7

### Patch Changes

- update deps

## 0.2.6

### Patch Changes

- update deps

## 0.2.5

### Patch Changes

- update deps

## 0.2.4

### Patch Changes

- import type only

## 0.2.3

### Patch Changes

- add stripe event handler util

## 0.2.2

### Patch Changes

- update deps

## 0.2.1

### Patch Changes

- add mapPaymentIntent

## 0.2.0

### Minor Changes

- rename mapStatus function, add mapCharge

## 0.1.19

### Patch Changes

- add mapInvoice and mapLineItem

## 0.1.18

### Patch Changes

- update deps

## 0.1.17

### Patch Changes

- update deps

## 0.1.16

### Patch Changes

- update deps

## 0.1.15

### Patch Changes

- chore: eslint

## 0.1.14

### Patch Changes

- update deps

## 0.1.13

### Patch Changes

- fix build

## 0.1.12

### Patch Changes

- add quantity support

## 0.1.11

### Patch Changes

- update deps
