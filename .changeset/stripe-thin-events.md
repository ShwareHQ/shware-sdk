---
'@shware/purchase': major
---

Add `StripeThinEventHandler`, a typed dispatcher for Stripe thin events: `on` is keyed by thin event type (`v1.invoice.paid`, `v1.customer.subscription.updated`, ...), each handler receives that type's `EventNotification` and reads current state itself with `fetchRelatedObject()` / `fetchEvent()`, and `process` takes the notification from `stripe.parseEventNotificationAsync`. `StripeThinEventType` and `StripeThinEventNotificationOf<T>` are exported for typing handlers.

When to use which: Stripe recommends thin events for new integrations, so prefer `StripeThinEventHandler`; keep `StripeEventHandler` (snapshot events) when you need the full payload as it was when the event fired, or `previous_attributes`.

Migration: requires stripe-node 23 (the `stripe` peer range is now `^23.0.0`); the snapshot `StripeEventHandler` is unchanged, `StripeThinEventHandler` is new.
