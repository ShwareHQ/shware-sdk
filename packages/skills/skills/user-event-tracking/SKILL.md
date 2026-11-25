---
name: user-event-tracking
description: Implement user event tracking and behavior analytics for frontend/app. Use when adding analytics, tracking user interactions, measuring conversions.
---

# User Event Tracking

This skill provides guidance for implementing user event tracking and behavior analytics in website/app.

## Instructions

1. Prefer using [Google Analytics 4 recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag) to benefit from built-in reporting support.
2. Use snake_case for event names and parameters.

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

Declare every custom event, with its properties, by merging into `CustomEventProperties`; find the project's existing `declare module '@shware/analytics'` block and add to it. If that block turns on `strict`, an undeclared event name is a compile error at every `track` call.

```ts
declare module '@shware/analytics' {
  interface CustomEventProperties {
    process_image: {
      image_id: string;
      image_url: string;
      image_size: number;
      image_format: string;
    };
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
