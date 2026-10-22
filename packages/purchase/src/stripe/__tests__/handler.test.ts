import type { Stripe } from 'stripe';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { StripeEventHandler } from '../handler';

// Minimal snapshot event: only what the dispatcher touches is real.
function event(type: Stripe.Event.Type, object: { id: string }): Stripe.Event {
  return { id: 'evt_123', object: 'event', type, data: { object } } as unknown as Stripe.Event;
}

const noop = () => vi.fn<(object: unknown) => Promise<void>>(async () => {});

describe('StripeEventHandler', () => {
  it('dispatches data.object to every handler registered for the type', async () => {
    const first = noop();
    const second = noop();
    const other = noop();
    const invoice = { id: 'in_123' };

    await StripeEventHandler.create()
      .on('invoice.paid', first)
      .on('invoice.paid', second)
      .on('customer.subscription.updated', other)
      .process(event('invoice.paid', invoice));

    expect(first).toHaveBeenCalledExactlyOnceWith(invoice);
    expect(second).toHaveBeenCalledExactlyOnceWith(invoice);
    expect(other).not.toHaveBeenCalled();
  });

  it('throws for a type with no handler', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = StripeEventHandler.create().on('invoice.paid', async () => {});

    await expect(handler.process(event('charge.refunded', { id: 'ch_123' }))).rejects.toThrow(
      'No stripe event handler found for event type: charge.refunded'
    );
    error.mockRestore();
  });

  it('narrows data.object by type', () => {
    StripeEventHandler.create()
      .on('invoice.paid', async (invoice) => {
        expectTypeOf(invoice).toEqualTypeOf<Stripe.Invoice>();
      })
      .on('customer.subscription.updated', async (sub) => {
        expectTypeOf(sub).toEqualTypeOf<Stripe.Subscription>();
      });
  });
});
