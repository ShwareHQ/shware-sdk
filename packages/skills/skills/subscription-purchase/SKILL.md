---
name: subscription-purchase
description: Entitlements, product catalogs, checkout and store webhooks with @shware/purchase across Stripe, the App Store and Google Play. Use when deciding whether a user has access, adding or changing a product or price, creating a checkout, or handling a Stripe, App Store or Google Play notification.
---

# Subscriptions and purchases

`@shware/purchase` maps all three stores onto one model, so the rest of the app never reads a store's own states. Mistakes here grant or revoke paid access, so follow these rules exactly.

## Entitlement: always `AVAILABLE_STATUSES`

Each store's `mapSubscription` returns a `SubscriptionState`, `{ status, autoRenewEnabled, trialStart, trialEnd }`, with `status` from the unified `SUBSCRIPTION_STATUSES`. Whether a user has access is one test, everywhere (API checks, credits, analytics, journeys):

```ts
import { AVAILABLE_STATUSES, type SubscriptionStatus } from '@shware/purchase';

const entitled = (AVAILABLE_STATUSES as readonly SubscriptionStatus[]).includes(sub.status);

// In SQL (Drizzle): the same list.
db.select()
  .from(subscription)
  .where(and(eq(subscription.userId, userId), inArray(subscription.status, AVAILABLE_STATUSES)));
```

Never write your own list (`status === 'ACTIVE'`, `status !== 'CANCELED'`). The non-obvious cases are already decided:

| Situation                                                 | Unified state                                             | Access |
| --------------------------------------------------------- | --------------------------------------------------------- | ------ |
| Free trial                                                | `TRIALING`                                                | yes    |
| User turned auto-renew off, period still running          | `ACTIVE` + `autoRenewEnabled: false`                      | yes    |
| Renewal failing, store still retrying and serving         | `IN_GRACE_PERIOD` (Apple, Play), `PAST_DUE` (Stripe)      | yes    |
| Retrying without serving (no grace period / account hold) | `BILLING_RETRY` (Apple), `ON_HOLD` (Play)                 | no     |
| Store gave up                                             | `UNPAID`, `EXPIRED`                                       | no     |
| Refunded or revoked                                       | `CANCELED` (Stripe `canceled`, Apple revoked)             | no     |
| Replaced by an upgrade/downgrade (Play)                   | `REPLACED`: the replacing purchase is the one that counts | no     |

So "the user cancelled" is **not** `CANCELED`: show "renews: off, access until …" from `autoRenewEnabled: false`, and keep serving them. To compare tiers among several active subscriptions, rank by the config's `plans` order (lowest first).

The constants are `as const` arrays: back database enums with them (`pgEnum('subscription_status', SUBSCRIPTION_STATUSES)`, `pgEnum('platform', PLATFORMS)`) instead of re-typing the values.

## Product catalogs

The catalog lives in one config per store (`defineStripeConfig`, `defineAppStoreConfig`, `defineGooglePlayConfig`, usually in the API's `config` module). Product ids, plans, billing periods, credits and trials come from it; never hard-code a price id, product id or credit amount elsewhere.

```ts
export const stripe = defineStripeConfig({
  namespace: 'com.example.stripe',
  plans: PLANS,
  billingPeriods: BILLING_PERIODS /* … */,
})
  .product('com.example.stripe.sub.monthly.starter', 'STARTER', 'MONTHLY')
  .price('price_live_starter_v2', { credits: 100, expiresIn: '30 days' })
  .price('price_live_starter_v1', { credits: 100, expiresIn: '30 days' }) // grandfathered: keep
  .default('price_live_starter_v2', { test: 'price_test_starter' });
```

Rules when changing it:

- **Never delete** a product, price or base plan that anyone may still be subscribed to. Add the new price, make it the `.default(...)`, and leave the old one declared: existing subscribers' webhooks resolve their plan and credits through it, and lookups throw for an unknown id.
- Every live default needs its `{ test: 'price_test_…' }` twin; in test mode `getPriceId` returns the twin, which resolves to the default's credits.
- `plans` is lowest tier first and `billingPeriods` shortest first: `comparePlans(from, to)` reads that order and returns `'upgrade' | 'downgrade' | 'longer' | 'shorter' | 'same'`. Use it to decide proration or messaging; do not compare plan names.
- Product ids must start with the config's `namespace`; plans, periods and duplicates are checked at compile time and when the config loads.
- `trialDays` (Stripe subscriptions only) only carries the number. Stripe grants the trial to every checkout that passes it, so pass `getTrialDays(productId)` only for users your own records say are eligible (e.g. never subscribed). App Store and Play trials are introductory offers set in their consoles.

Lookups: `getPriceId`, `getProductId(priceId)`, `getPlan`, `getBillingPeriod`, `getMode` (`'payment' | 'subscription'`), `isSubscription`, `getCreditAmount(productId, priceId?)`, `getCreditExpiresAt(productId, priceId?)` on Stripe; the App Store and Play configs have their own (`getDefaultProductId(plan, period)`, `getPlan(productId, basePlanId)`, …).

## Stripe checkout

Validate the request with `createCheckoutSessionSchema(config.stripe.productIds, { allowedOrigins })`: it rejects unknown products, and rejects a client-supplied `successUrl` / `cancelUrl` outside `allowedOrigins` (usually just the web app's origin). Without that check anyone could create a session ending on a page of their choosing behind `checkout.stripe.com`, an open redirect; validate any other URL handed to Stripe (a billing portal `return_url`) with `returnUrlSchema(allowedOrigins)` for the same reason. The schema also accepts an optional `promotionCode`, which the server resolves to a discount itself. Put the ids the webhook needs into metadata under `METADATA_KEYS`; never invent metadata key strings.

```ts
import { zValidator } from '@shware/http/hono';
import { METADATA_KEYS, createCheckoutSessionSchema } from '@shware/purchase/stripe';

const checkoutSchema = createCheckoutSessionSchema(config.stripe.productIds, {
  allowedOrigins: [config.appOrigin],
});

app.post('/v1/checkout/sessions', zValidator('json', checkoutSchema), async (c) => {
  const { productId, quantity, cancelUrl, successUrl } = c.req.valid('json');
  const trialDays = (await isEligibleForTrial(userId))
    ? config.stripe.getTrialDays(productId)
    : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: config.stripe.getMode(productId),
    line_items: [{ price: config.stripe.getPriceId(productId), quantity }],
    ...(trialDays && { subscription_data: { trial_period_days: trialDays } }),
    metadata: { [METADATA_KEYS.USER_ID]: userId, [METADATA_KEYS.PRODUCT_ID]: productId },
    allow_promotion_codes: config.stripe.allowPromotionCodes,
    success_url: successUrl ?? config.stripe.successUrl,
    cancel_url: cancelUrl ?? config.stripe.cancelUrl,
  });
  return c.json({ id: session.id, url: session.url });
});
```

In the browser (`@shware/purchase/stripe` has no runtime dependency on `stripe` for these):

- `addPendingCheckout(session.id)` before redirecting to Stripe; on app start, confirm each of `getPendingCheckouts()` and `removePendingCheckout(id)`. This catches users who paid but closed the tab before the success page.
- `getBeginCheckoutProperties(productPrice)` / `getPurchaseProperties(checkoutSession)` build the GA4 `begin_checkout` / `purchase` properties; pass them to `track` instead of assembling them.
- `price(unitAmount, currency)` turns Stripe minor units into an amount, correct for zero-decimal currencies (JPY, KRW): never divide by 100.

## Store notifications

The same rules for all three stores:

1. **Verify first**: Stripe `parseEventNotificationAsync` (thin) or `webhooks.constructEventAsync` (snapshot); Apple's `SignedDataVerifier`; Play's Pub/Sub OIDC token (audience `config.googlePlay.audience`).
2. **Write current state, not the notification.** Delivery order means nothing. Re-read the subscription from the store and store `mapSubscription(...)`: Stripe `notification.fetchRelatedObject()`, Apple Get All Subscription Statuses, Play `purchases.subscriptionsv2.get`.
3. **Make one-off effects idempotent.** Granting credits, recording a payment or a refund must be keyed (invoice id, transaction id, order id) so a redelivered or duplicate notification grants once.
4. **A free trial grants nothing.** The trial's $0 transaction/order is not a payment; credits come with the first real charge, which arrives as its own event (Stripe `invoice.paid`, Apple `DID_RENEW`, Play's next order).

Stripe: prefer thin events with `StripeThinEventHandler` (types prefixed `v1.`); every registered handler for a type runs, and `process` throws for a type with no handler, so register exactly the types the event destination sends.

```ts
import {
  METADATA_KEYS,
  StripeThinEventHandler,
  type StripeThinEventNotificationOf,
  mapSubscription,
} from '@shware/purchase/stripe';

const handler = StripeThinEventHandler.create()
  .on('v1.customer.subscription.created', handleSubscription)
  .on('v1.customer.subscription.updated', handleSubscription)
  .on('v1.customer.subscription.deleted', handleSubscription)
  .on('v1.invoice.paid', handleInvoicePaid);

// One handler for several types: type it with the union.
async function handleSubscription(
  notification: StripeThinEventNotificationOf<
    | 'v1.customer.subscription.created'
    | 'v1.customer.subscription.updated'
    | 'v1.customer.subscription.deleted'
  >
) {
  const sub = await notification.fetchRelatedObject(); // current state
  const productId = sub.metadata[METADATA_KEYS.PRODUCT_ID];
  await saveSubscription({
    userId: sub.metadata[METADATA_KEYS.USER_ID],
    plan: config.stripe.getPlan(productId),
    billingPeriod: config.stripe.getBillingPeriod(productId),
    // status, autoRenewEnabled, trial dates, price, renewalAt, canceledAt, cancellationDetails
    ...mapSubscription(sub),
  });
}
```

App Store: dispatch with `AppStoreNotificationHandler` by `notificationType`, branch on `subtype` inside a handler, and save `mapSubscription({ status, transaction, renewalInfo })` from Get All Subscription Statuses. Apple drops the trial dates once a paid transaction follows, so keep the stored ones.

Google Play: decode the RTDN (`DeveloperNotification`), fetch `purchases.subscriptionsv2`, and save `mapSubscription(data)`; it reads the whole resource, because Play's `SUBSCRIPTION_STATE_CANCELED` is auto-renew off (still `ACTIVE`), not a revocation. Resolve the plan with `config.googlePlay.getPlan(productId, basePlanId)`.

Why a subscription stopped renewing is one record for every store: `mapCancellationDetails(...)` returns `CancellationDetails` (`initiator`, `reason`, `feedback`, `comment`, `resubscribeIntent`); validate your own cancel dialog with `cancellationDetailsSchema`.
