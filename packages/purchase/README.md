# @shware/purchase

Shared building blocks for selling subscriptions and credits on Stripe, the App Store and Google
Play. The root export holds a platform-neutral subscription model (statuses, cancellation details)
and the three product catalogs (`StripeConfig`, `AppStoreConfig`, `GooglePlayConfig`) that map
store product ids to your plans, billing periods and credit grants. The platform subpaths add
typed event dispatchers and mappers from each store's payloads onto that model. Verifying webhook
signatures and calling store APIs stays in your app, with the official SDKs.

## Install

```sh
pnpm add @shware/purchase zod
# optional peers, only for the subpaths you use
pnpm add stripe                            # @shware/purchase/stripe (^23.0.0)
pnpm add @apple/app-store-server-library   # @shware/purchase/app-store (^3.1.0)
```

## Entry points

| Import path                    | Contents                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `@shware/purchase`             | Subscription model (`PLATFORMS`, `SUBSCRIPTION_STATUSES`, `AVAILABLE_STATUSES`, cancellation types) and the three configs    |
| `@shware/purchase/stripe`      | `StripeEventHandler`, Stripe mappers, checkout schemas, `METADATA_KEYS`, analytics helpers, browser pending-checkout helpers |
| `@shware/purchase/app-store`   | `AppStoreNotificationHandler` for App Store Server Notifications V2, `mapCancellationDetails`                                |
| `@shware/purchase/google-play` | Real-time developer notification (RTDN) types and enums, subscription state and cancellation mappers                         |

## Subscription model

```ts
import {
  AVAILABLE_STATUSES,
  PLATFORMS,
  SUBSCRIPTION_STATUSES,
  type CancellationDetails,
  type Platform,
  type SubscriptionStatus,
} from '@shware/purchase';
```

- `PLATFORMS`: `'APPLE' | 'GOOGLE' | 'STRIPE'`.
- `SUBSCRIPTION_STATUSES`: the union of every store's states (`TRIALING`, `ACTIVE`,
  `IN_GRACE_PERIOD`, `PAST_DUE`, `ON_HOLD`, `PAUSED`, `CANCELED`, `EXPIRED`, ...). Each platform
  mapper returns one of these.
- `AVAILABLE_STATUSES`: `ACTIVE`, `TRIALING`, `IN_GRACE_PERIOD`, the statuses that grant access.
- `CancellationDetails`: why a subscription stopped renewing, one record for all platforms:
  `initiator` (`CANCELLATION_INITIATORS`: `user`, `system`, `developer`), the store's own `reason`,
  `feedback` (`CANCELLATION_FEEDBACKS`), `comment` and `resubscribeIntent` (`RESUBSCRIBE_INTENTS`).

The constants are `as const` arrays, so they can back database enums directly:

```ts
import { PLATFORMS, SUBSCRIPTION_STATUSES } from '@shware/purchase';
import { pgEnum } from 'drizzle-orm/pg-core';

export const platform = pgEnum('platform', PLATFORMS);
export const subscriptionStatus = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
```

```ts
const entitled = (AVAILABLE_STATUSES as readonly SubscriptionStatus[]).includes(sub.status);
```

## Product catalogs

Each config is built with a fluent, type-checked chain. Type parameters are the product id
namespace, your plan type and your billing period type; product ids must start with the namespace,
and duplicate products or plan/period pairs fail at compile time and at runtime. Credit metadata
is `{ credits: number; expiresIn: string }` where `expiresIn` is an
[`ms`](https://github.com/vercel/ms) duration.

```ts
import { AppStoreConfig, GooglePlayConfig, StripeConfig } from '@shware/purchase';

type Plan = 'STARTER' | 'PRO';
type BillingPeriod = 'MONTHLY' | 'YEARLY';

export const stripe = StripeConfig.create<'com.example.stripe', Plan, BillingPeriod>({
  mode: env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'test' : 'live',
  allowPromotionCodes: false,
  cancellationCouponId: 'retention_30pct_3mo',
  returnUrl: 'https://example.com',
  cancelUrl: 'https://example.com',
  successUrl: 'https://example.com/payments/success?session_id={CHECKOUT_SESSION_ID}',
})
  // one-time product: no plan or period
  .product('com.example.stripe.credit.starter')
  .price('price_live_credits', { credits: 10, expiresIn: '1 year' })
  .default('price_live_credits', { test: 'price_test_credits' })
  // subscription: plan + billing period
  .product('com.example.stripe.sub.monthly.starter', 'STARTER', 'MONTHLY')
  .price('price_live_starter_v2', { credits: 100, expiresIn: '30 days' })
  .price('price_live_starter_v1', { credits: 100, expiresIn: '30 days' }) // grandfathered
  .default('price_live_starter_v2', { test: 'price_test_starter' });

export const appStore = AppStoreConfig.create<'com.example.appstore', Plan, BillingPeriod>({
  appId: '1234567890',
  bundleId: 'com.example.app',
})
  .consumable('com.example.appstore.credit.starter', { credits: 10, expiresIn: '365d' })
  .subscription('STARTER', 'MONTHLY')
  .product('com.example.appstore.sub.monthly.starter.v1', { credits: 100, expiresIn: '30d' })
  .default('com.example.appstore.sub.monthly.starter.v1');

export const googlePlay = GooglePlayConfig.create<'com.example.googleplay', Plan, BillingPeriod>({
  package: 'com.example.app',
  audience: 'api.example.com', // expected audience of the RTDN push OIDC token
})
  .subscription('com.example.googleplay.sub.starter')
  .basePlan('monthly-v1', 'STARTER', 'MONTHLY', { credits: 100, expiresIn: '30d' })
  .basePlan('yearly-v1', 'STARTER', 'YEARLY', { credits: 1200, expiresIn: '365d' })
  .default(['monthly-v1', 'yearly-v1'])
  .onetime('com.example.googleplay.credit.starter', { credits: 10, expiresIn: '365d' });
```

Lookups:

| Config             | Methods                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StripeConfig`     | `productIds`, `getPriceId(productId)`, `getPlan`, `getBillingPeriod`, `getMode`, `getCreditAmount(productId, priceId?)`, `getCreditExpiresAt(productId, priceId?)`                                            |
| `AppStoreConfig`   | `productIds`, `getDefaultProductId(plan, billingPeriod)`, `getPlan`, `getBillingPeriod`, `getMode`, `getCreditAmount`, `getCreditExpiresAt`                                                                   |
| `GooglePlayConfig` | `productIds`, `getDefaultPlanIds(productId)`, `getPlan(productId, planId)`, `getBillingPeriod(productId, planId)`, `getMode`, `getCreditAmount(productId, planId?)`, `getCreditExpiresAt(productId, planId?)` |

In Stripe test mode the `test` twin of the default price is what `getPriceId` returns, and it
resolves to the default price's credits. Non-default prices, products and base plans stay declared
so existing subscribers keep resolving.

## Stripe

`@shware/purchase/stripe` (requires `stripe`).

### Webhooks

`StripeEventHandler` dispatches Stripe [thin events](https://docs.stripe.com/events/how-events-work#event-formats).
A thin event only says which object changed (`type`, `id`, `created`, `reason`, `related_object`),
so each handler reads current state from Stripe with `notification.fetchRelatedObject()` (or the
full event with `fetchEvent()`). The SDK never pre-fetches: some handlers only need
`related_object.id`. `on` is keyed by thin event type (`v1.customer.subscription.updated`, ...) and
each handler receives that type's notification, so `fetchRelatedObject()` resolves to the right
Stripe object. Every handler registered for a type runs; `process` throws for a type with no
handler. Delivery order carries no meaning: re-read state instead of applying payloads in order,
and dedupe one-off facts (credits, payments, refunds) with idempotency keys.

Create the event destination with the thin payload style and the `v1.*` types you handle. A
Cloudflare Workers route with Hono (`parseEventNotificationAsync` uses Web Crypto there):

```ts
import {
  METADATA_KEYS,
  StripeEventHandler,
  type StripeEventNotificationOf,
  mapCancellationDetails,
  mapSubscriptionStatus,
  mapTime,
} from '@shware/purchase/stripe';
import Stripe from 'stripe';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const handler = StripeEventHandler.create()
  .on('v1.checkout.session.completed', handleCheckoutSessionCompleted)
  .on('v1.invoice.paid', handleInvoicePaid)
  .on('v1.customer.subscription.created', handleSubscriptionEvent)
  .on('v1.customer.subscription.updated', handleSubscriptionEvent)
  .on('v1.customer.subscription.deleted', handleSubscriptionEvent);

app.post('/webhooks/stripe', async (c) => {
  const notification = await stripe.parseEventNotificationAsync(
    await c.req.text(),
    c.req.header('stripe-signature') ?? '',
    env.STRIPE_WEBHOOK_SECRET
  );
  await handler.process(notification);
  return c.body(null, 204);
});

async function handleSubscriptionEvent(
  notification: StripeEventNotificationOf<
    | 'v1.customer.subscription.created'
    | 'v1.customer.subscription.updated'
    | 'v1.customer.subscription.deleted'
  >
) {
  const sub = await notification.fetchRelatedObject(); // Stripe.Subscription, current state
  const userId = sub.metadata[METADATA_KEYS.USER_ID];
  const productId = sub.metadata[METADATA_KEYS.PRODUCT_ID];
  await saveSubscription({
    userId,
    platform: 'STRIPE',
    plan: config.stripe.getPlan(productId),
    billingPeriod: config.stripe.getBillingPeriod(productId),
    status: mapSubscriptionStatus(sub.status),
    startedAt: mapTime(sub.start_date),
    cancellationDetails: mapCancellationDetails(sub),
  });
}
```

#### Migrating from snapshot events (6.x)

- Switch the webhook endpoint (event destination) to the thin payload style; snapshot payloads
  are rejected by `parseEventNotificationAsync`.
- Replace `stripe.webhooks.constructEventAsync(...)` with `stripe.parseEventNotificationAsync(...)`
  and pass the notification to `process`.
- Prefix every `on` type with `v1.` (`invoice.paid` becomes `v1.invoice.paid`).
- Handlers receive the notification instead of `event.data.object`: call
  `await notification.fetchRelatedObject()` for the object, or use `notification.related_object.id`
  when the id is enough. The fetched object is the current state, not the state when the event
  fired, so handlers must not depend on delivery order.
- The mappers (`mapSubscriptionStatus`, `mapInvoice`, `mapCancellationDetails`, ...) are unchanged
  and take the fetched objects.

### Checkout

`createCheckoutSessionSchema(productIds)` is a `zod/mini` schema for the create-checkout request
(`productId`, `quantity` default 1, optional `cancelUrl` / `successUrl`). `METADATA_KEYS` names
the metadata fields (`user_id`, `product_id`, `referral_code`, ...) the webhook reads back.

```ts
import { zValidator } from '@hono/zod-validator';
import { METADATA_KEYS, createCheckoutSessionSchema } from '@shware/purchase/stripe';

app.post(
  '/v1/checkout/sessions',
  zValidator('json', createCheckoutSessionSchema(config.stripe.productIds)),
  async (c) => {
    const { productId, quantity, cancelUrl, successUrl } = c.req.valid('json');
    const userId = await getUserId(c);
    const session = await stripe.checkout.sessions.create({
      mode: config.stripe.getMode(productId),
      line_items: [{ price: config.stripe.getPriceId(productId), quantity }],
      metadata: { [METADATA_KEYS.USER_ID]: userId, [METADATA_KEYS.PRODUCT_ID]: productId },
      allow_promotion_codes: config.stripe.allowPromotionCodes,
      success_url: successUrl ?? config.stripe.successUrl,
      cancel_url: cancelUrl ?? config.stripe.cancelUrl,
    });
    return c.json({ id: session.id, url: session.url });
  }
);
```

`cancellationDetailsSchema` validates what your own cancel dialog sends (`comment`, `feedback`,
`resubscribeIntent`).

### Mappers

Plain-JSON views of Stripe objects for API responses: `mapCheckoutSession`, `mapLineItem`,
`mapPrice`, `mapInvoice`, `mapPaymentIntent`, `mapCharge`, plus `mapSubscriptionStatus`,
`mapCancellationDetails` and `mapTime` (Unix seconds to ISO string, `null` passes through).

### Browser helpers

These run in the browser and have no runtime dependency on `stripe`:

- `price(value, currency)` / `minorUnits(currency)`: convert minor units to a display amount,
  aware of zero-decimal currencies.
- `getBeginCheckoutProperties(productPrice)` and `getPurchaseProperties(checkoutSession)`:
  GA4-style `begin_checkout` / `purchase` event properties.
- `addPendingCheckout(sessionId)`, `getPendingCheckouts()`, `removePendingCheckout(sessionId)`:
  a `localStorage` list (one-hour TTL) of checkouts to re-confirm if the user closed the tab before
  returning to the success page.

```ts
import {
  addPendingCheckout,
  getPendingCheckouts,
  removePendingCheckout,
} from '@shware/purchase/stripe';

// before redirecting to Stripe
addPendingCheckout(session.id);

// on app start
for (const sessionId of getPendingCheckouts()) {
  await confirmCheckoutSession(sessionId);
  removePendingCheckout(sessionId);
}
```

## App Store

`@shware/purchase/app-store` (requires `@apple/app-store-server-library`).

Decode and verify the notification with Apple's `SignedDataVerifier`, then dispatch the decoded
event by `notificationType` with `AppStoreNotificationHandler`. Branch on `subtype` inside each
handler.

```ts
import { NotificationTypeV2, type SignedDataVerifier } from '@apple/app-store-server-library';
import {
  type AppStoreNotificationEvent,
  AppStoreNotificationHandler,
  mapCancellationDetails,
} from '@shware/purchase/app-store';

export async function processAppStoreNotification(verifier: SignedDataVerifier, body: string) {
  const payload = await verifier.verifyAndDecodeNotification(body);
  const { signedTransactionInfo, signedRenewalInfo } = payload.data ?? {};
  const transaction = signedTransactionInfo
    ? await verifier.verifyAndDecodeTransaction(signedTransactionInfo)
    : null;
  const renewalInfo = signedRenewalInfo
    ? await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)
    : null;

  await AppStoreNotificationHandler.create()
    .on(NotificationTypeV2.SUBSCRIBED, handleSubscribed)
    .on(NotificationTypeV2.DID_RENEW, handleRenewed)
    .on(NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS, handleRenewalStatusChanged)
    .on(NotificationTypeV2.EXPIRED, handleExpired)
    .on(NotificationTypeV2.REFUND, handleRefunded)
    .process({ payload, transaction, renewalInfo });
}

async function handleRenewalStatusChanged({ payload, renewalInfo }: AppStoreNotificationEvent) {
  const cancellationDetails = mapCancellationDetails({
    notificationType: payload.notificationType!,
    subtype: payload.subtype,
    expirationIntent: renewalInfo?.expirationIntent,
  });
  // null when auto-renew was turned back on
}
```

Map `transaction.productId` to your plan with `config.appStore.getPlan(productId)` and
`getBillingPeriod(productId)`, and grant credits with `getCreditAmount` / `getCreditExpiresAt`.

## Google Play

`@shware/purchase/google-play` (no peer dependency).

It provides the RTDN payload types (`PubsubMessage`, `DeveloperNotification`,
`SubscriptionNotification`, `OneTimeProductNotification`, `VoidedPurchaseNotification`,
`TestNotification`), the numeric enums (`SubscriptionNotificationType`,
`OneTimeProductNotificationType`, `VoidedPurchaseProductType`, `VoidedPurchaseRefundType`), and
mappers for the `purchases.subscriptionsv2` resource. Verify the Pub/Sub push token (its audience
is `config.googlePlay.audience`) and fetch the purchase with the Android Publisher API yourself.

```ts
import {
  type DeveloperNotification,
  type GooglePlaySubscriptionState,
  type PubsubMessage,
  mapCanceledAt,
  mapCancellationDetails,
  mapSubscriptionStatus,
} from '@shware/purchase/google-play';

export async function processGooglePlayNotification(authorization: string, body: string) {
  await verifyIdToken(authorization.replace('Bearer ', '')); // your OIDC check

  const { message } = JSON.parse(body) as { message: PubsubMessage };
  const notification = JSON.parse(
    Buffer.from(message.data, 'base64').toString('utf-8')
  ) as Partial<DeveloperNotification>;

  if (notification.subscriptionNotification) {
    const { purchaseToken } = notification.subscriptionNotification;
    const { data } = await publisher.purchases.subscriptionsv2.get({
      packageName: config.googlePlay.package,
      token: purchaseToken,
    });
    const status = mapSubscriptionStatus(data.subscriptionState as GooglePlaySubscriptionState);
    const cancellationDetails = mapCancellationDetails(data.canceledStateContext);
    const canceledAt = mapCanceledAt(data.canceledStateContext);
    // save status, cancellationDetails, canceledAt ...
  }
}
```

Resolve the plan from a line item with `config.googlePlay.getPlan(productId, basePlanId)` and
`getBillingPeriod(productId, basePlanId)`. `GOOGLE_PLAY_SUBSCRIPTION_STATES` lists the raw
`SUBSCRIPTION_STATE_*` values.
