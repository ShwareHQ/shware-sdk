---
'@shware/purchase': major
---

`StripeEventHandler` now dispatches Stripe thin events: `on` is keyed by thin event type (`v1.invoice.paid`, `v1.customer.subscription.updated`, ...), each handler receives that type's typed `EventNotification` and reads current state itself with `fetchRelatedObject()` / `fetchEvent()`, and `process` takes the notification from `stripe.parseEventNotificationAsync`. The snapshot-event API is removed, the `stripe` peer range is now `^23.0.0`, and `StripeEventType` / `StripeEventNotificationOf<T>` are exported for typing handlers shared across types.

Migration from 6.x (apps not ready to switch can stay on 6.x):

- Switch the Stripe event destination to the thin payload style, subscribed to the `v1.*` types you handle.
- Verify with `stripe.parseEventNotificationAsync(body, signature, secret)` instead of `stripe.webhooks.constructEventAsync(...)`, then pass the notification to `process`.
- Prefix every `on` type with `v1.` (`customer.subscription.updated` becomes `v1.customer.subscription.updated`).
- Handlers get the notification instead of `event.data.object`: call `await notification.fetchRelatedObject()` for the object, or read `notification.related_object.id` when the id is enough. The fetched object is current state rather than a snapshot, so handlers must not depend on delivery order; dedupe one-off facts with idempotency keys.
- The mappers are unchanged and take the fetched objects.
