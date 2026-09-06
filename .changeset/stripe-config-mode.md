---
'@shware/purchase': major
---

`StripeConfig` is built for one Stripe mode and `default()` takes a sandbox twin price.

BREAKING CHANGES:

- `StripeConfig.create()` requires `mode: 'live' | 'test'`. Derive it from the secret key prefix (`sk_test_` → `'test'`, otherwise `'live'`) so the config can never disagree with the key the API calls are made with. There is no default: a config that silently assumed live is exactly the mistake this prevents.
- `Product#default(priceId, twin?)` accepts `{ test: PriceId }`. In test mode the twin is required, `getPriceId()` returns it, and `getCreditAmount()` / `getCreditExpiresAt()` resolve it to the default price's entitlement, so credits are declared once and cannot drift between modes. Live mode ignores the twin: a test price reaching a live config still fails as `Price not found`. Legacy (non-default) prices take no twin, since a sandbox holds no grandfathered subscribers.

New:

- `StripeConfig#mode` is exposed so consumers can assert `event.livemode` against it in webhook handlers.
- `StripeMode` type export.
