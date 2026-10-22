import type { Stripe } from 'stripe';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { StripeThinEventHandler, type StripeThinEventNotificationOf } from '../thin-handler';

// Minimal stand-in for what `stripe.parseEventNotificationAsync` returns: the thin payload fields
// plus the bound fetch methods. Only what the dispatcher touches is real.
function stub<T extends Stripe.V2.Core.EventNotification['type']>(type: T, id = 'in_123') {
  const fetchRelatedObject = vi.fn<() => Promise<unknown>>(async () => ({ id }));
  const fetchEvent = vi.fn<() => Promise<unknown>>(async () => ({ id: 'evt_123', type }));
  const notification = {
    id: 'evt_123',
    object: 'v2.core.event',
    type,
    created: '2026-10-22T00:00:00.000Z',
    livemode: false,
    related_object: { id, type: 'invoice', url: `/v1/invoices/${id}` },
    fetchRelatedObject,
    fetchEvent,
  } as unknown as StripeThinEventNotificationOf<T>;
  return { notification, fetchRelatedObject, fetchEvent };
}

const noop = () => vi.fn<(notification: unknown) => Promise<void>>(async () => {});

describe('StripeThinEventHandler', () => {
  it('dispatches to every handler registered for the type', async () => {
    const first = noop();
    const second = noop();
    const other = noop();
    const { notification: n } = stub('v1.invoice.paid');

    await StripeThinEventHandler.create()
      .on('v1.invoice.paid', first)
      .on('v1.invoice.paid', second)
      .on('v1.customer.subscription.updated', other)
      .process(n);

    expect(first).toHaveBeenCalledExactlyOnceWith(n);
    expect(second).toHaveBeenCalledExactlyOnceWith(n);
    expect(other).not.toHaveBeenCalled();
  });

  it('leaves fetching to the handler', async () => {
    const {
      notification: n,
      fetchRelatedObject,
      fetchEvent,
    } = stub('v1.customer.subscription.updated', 'sub_123');
    const seen: string[] = [];

    await StripeThinEventHandler.create()
      .on('v1.customer.subscription.updated', async (e) => {
        seen.push(e.related_object.id);
      })
      .process(n);

    expect(seen).toEqual(['sub_123']);
    expect(fetchRelatedObject).not.toHaveBeenCalled();
    expect(fetchEvent).not.toHaveBeenCalled();
  });

  it('throws for a type with no handler', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = StripeThinEventHandler.create().on('v1.invoice.paid', async () => {});

    await expect(handler.process(stub('v1.charge.refunded').notification)).rejects.toThrow(
      'No stripe event handler found for event type: v1.charge.refunded'
    );
    error.mockRestore();
  });

  it('narrows the notification by type', () => {
    StripeThinEventHandler.create()
      .on('v1.invoice.paid', async (n) => {
        expectTypeOf(n.type).toEqualTypeOf<'v1.invoice.paid'>();
        expectTypeOf(n.fetchRelatedObject()).resolves.toEqualTypeOf<Stripe.Invoice>();
      })
      .on('v1.customer.subscription.updated', async (n) => {
        expectTypeOf(n.fetchRelatedObject()).resolves.toEqualTypeOf<Stripe.Subscription>();
      })
      .on('v1.checkout.session.completed', async (n) => {
        expectTypeOf(n.fetchRelatedObject()).resolves.toEqualTypeOf<Stripe.Checkout.Session>();
      })
      .on('v1.charge.dispute.created', async (n) => {
        expectTypeOf(n.fetchRelatedObject()).resolves.toEqualTypeOf<Stripe.Dispute>();
      });

    // One function can serve several types; it sees the union of their notifications.
    const onSubscription = async (
      n: StripeThinEventNotificationOf<
        'v1.customer.subscription.created' | 'v1.customer.subscription.deleted'
      >
    ) => {
      expectTypeOf(n.fetchRelatedObject()).resolves.toEqualTypeOf<Stripe.Subscription>();
    };
    StripeThinEventHandler.create()
      .on('v1.customer.subscription.created', onSubscription)
      .on('v1.customer.subscription.deleted', onSubscription);

    // @ts-expect-error snapshot event types are not thin event types
    StripeThinEventHandler.create().on('invoice.paid', async () => {});
  });
});
