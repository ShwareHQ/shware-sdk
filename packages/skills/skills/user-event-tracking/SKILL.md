---
name: user-event-tracking
description: Implement user event tracking and behavior analytics for web and apps with @shware/analytics (track, trackOnce, useTrackImpression, identify, reset, typed custom events). Use when adding analytics, tracking user interactions or conversions, or wiring sign-in and sign-out.
---

# User Event Tracking

This skill provides guidance for implementing user event tracking and behavior analytics in website/app.

## Instructions

1. Prefer using [Google Analytics 4 recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag) to benefit from built-in reporting support.
2. Use snake_case for event names and parameters.
3. An occurrence that can be reported twice (a result page reloaded, a store transaction redelivered) goes through `trackOnce` with the occurrence's own id as its key.
4. Bind the visitor to the user with `identify` and end it with `reset`; never send the user id as an event property instead.

## Users: `identify` and `reset`

- **`identify(userId, userData?)` on every app start or page load where someone is signed in**, and right after sign-in: not just once. It hands the user to the analytics server and the pixels; it only sends an `identify` event when the user differs from the one this device last identified, so calling it often is free. `userData` (e.g. `{ email }`) goes to the ad pixels for matching only. Signing in as a different user starts a new visitor on its own.
- **`reset()` at sign-out**, after tracking `logout`, which still belongs to the user leaving. Call it whenever the session ends (expiry, account deletion) and from every tab that notices; a late or repeated call does not cut off the next user.

```ts
import { identify, reset, track } from '@shware/analytics';

// Sign-in succeeded.
identify(user.id, { email: user.email });
track('login', { method: 'google' });

// On every load with a session (e.g. where the profile query resolves).
if (profile) identify(profile.id);

// Sign-out: logout first, then reset.
track('logout');
reset();
```

## Tracking an occurrence once: `trackOnce`

`trackOnce(name, properties, { key })` tracks at most once per key on this device, so a reload, a back navigation or a redelivered store transaction does not report a second purchase. The key is the occurrence's id (a Stripe checkout session id, a store transaction id), never derived from the properties; the same key under another event name is a separate occurrence.

```ts
import { trackOnce } from '@shware/analytics';
import { getPurchaseProperties } from '@shware/purchase/stripe';

// The payment result page, which can be reloaded or reopened from history.
trackOnce('purchase', getPurchaseProperties(session), { key: session.id });
if (isTrial) trackOnce('trial_begin', { currency, value: 0 }, { key: session.id });
```

Use it for conversions (`purchase`, `trial_begin`, `purchase_failed`, `sign_up` from a confirmation link) and `track` for everything else. A failed send is retried by the next call under the same event id, so the server and the pixels deduplicate it. Deduplication is per device: exact revenue belongs to server-side records.

## Examples

### Tracking key events in the user conversion funnel

```tsx
import { track } from '@shware/analytics';

export default function PurchaseButton() {
  const onClick = () => {
    const item = { item_id: 'sku_123', item_name: 'Book 1', quantity: 1 };
    track('begin_checkout', {
      value: 14.99,
      currency: 'USD',
      coupon: 'BF2025',
      items: [item],
    });
    // open checkout page...
  };

  return <button onClick={onClick}>Purchase</button>;
}
```

### Tracking the effectiveness of marketing campaigns

For marketing activities in web/app, make sure to send `view_promotion` and `select_promotion` events. For example, trigger `view_promotion` when displaying a promotional banner (such as a countdown discount), and trigger `select_promotion` when the banner is clicked—regardless of whether the user completes a purchase. As soon as the user clicks, immediately send the `select_promotion` event.

```tsx
import { track, useTrackImpression } from '@shware/analytics';

export function HomeHero() {
  // A callback ref: the event fires once, when at least half of the element is visible.
  const ref = useTrackImpression('view_promotion', {
    promotion_id: 'bf_2025_home_hero',
    promotion_name: 'BlackFriday 2025',
    creative_name: '50%OFF_dark_banner',
    creative_slot: 'homepage_hero_1',
    // Required by `view_promotion`: the products the promotion offers.
    items: [{ item_id: 'sku_annual', item_name: 'Annual plan' }],
  });

  const onClick = () => {
    track('select_promotion', {
      promotion_id: 'bf_2025_home_hero',
      promotion_name: 'BlackFriday 2025',
    });
  };

  return (
    <div ref={ref}>
      <span>Black Friday: 50% off, limited time only!</span>
      <button onClick={onClick}>Purchase Now!</button>
    </div>
  );
}
```

### Using Custom Events

Declare every custom event, with its properties, by merging into `CustomEventProperties`. Find the project's existing `declare module '@shware/analytics'` block and add to it; create one (e.g. `src/analytics.d.ts` or a shared contract package) only if there is none.

Turn on `strict` in `AnalyticsOptions` in the same block. It constrains every event name app-wide — in `track`, `trackOnce`, `sendBeacon`, `useTrackImpression` and the third-party senders — to GA4's standard events and the keys of `CustomEventProperties`, so a typo (`purchse`) or an undeclared event is a compile error at the call site instead of a new event in the reports. It is type-only and changes nothing at runtime. Without it, an undeclared event still compiles, with open properties.

```ts
declare module '@shware/analytics' {
  interface AnalyticsOptions {
    strict: true;
  }
  interface CustomEventProperties {
    process_image: {
      image_id: string;
      image_url: string;
      image_size: number;
      image_format: string;
    };
    account_deleted: undefined; // an event with no properties
  }
}
```

```tsx
import { track } from '@shware/analytics';

export default function ProcessImageButton() {
  const onClick = () => {
    track('process_image', {
      image_id: 'img_123',
      image_url: 'https://example.com/image.jpg',
      image_size: 1024,
      image_format: 'jpg',
    });
  };

  return <button onClick={onClick}>Process</button>;
}
```
