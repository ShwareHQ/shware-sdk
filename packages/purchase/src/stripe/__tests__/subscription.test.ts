import type { Stripe } from 'stripe';
import { describe, expect, it } from 'vitest';
import { cancellationComment, mapCancellationDetails } from '../mapper';
import { mapListPrice, mapSubscription } from '../subscription';

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, feedback_option: null, reason: null },
    start_date: 1_700_000_000,
    created: 1_700_000_000,
    trial_start: null,
    trial_end: null,
    items: {
      data: [
        {
          quantity: 1,
          current_period_end: 1_702_592_000,
          price: { unit_amount: 1999, currency: 'usd' },
        },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

describe('mapSubscription', () => {
  it('maps a renewing subscription', () => {
    expect(mapSubscription(subscription())).toEqual({
      status: 'ACTIVE',
      autoRenewEnabled: true,
      price: { amount: 19.99, currency: 'usd' },
      startedAt: '2023-11-14T22:13:20.000Z',
      createdAt: '2023-11-14T22:13:20.000Z',
      renewalAt: '2023-12-14T22:13:20.000Z',
      trialStart: null,
      trialEnd: null,
      canceledAt: null,
      cancellationDetails: null,
    });
  });

  it('stops auto-renew for every way a subscription can be set to end', () => {
    expect(mapSubscription(subscription({ cancel_at_period_end: true })).autoRenewEnabled).toBe(
      false
    );
    expect(mapSubscription(subscription({ cancel_at: 1_702_592_000 })).autoRenewEnabled).toBe(
      false
    );
    expect(mapSubscription(subscription({ status: 'canceled' })).autoRenewEnabled).toBe(false);
  });

  it('has no renewal date while paused', () => {
    expect(mapSubscription(subscription({ status: 'paused' })).renewalAt).toBeNull();
  });
});

describe('mapListPrice', () => {
  it('is the unit amount times the quantity, in currency units', () => {
    const items = { data: [{ quantity: 3, price: { unit_amount: 500, currency: 'jpy' } }] };
    expect(mapListPrice({ items } as Stripe.Subscription)).toEqual({
      amount: 1500,
      currency: 'jpy',
    });
  });

  it('is null for a price without a flat amount', () => {
    const items = { data: [{ quantity: 1, price: { unit_amount: null, currency: 'usd' } }] };
    expect(mapListPrice({ items } as Stripe.Subscription)).toBeNull();
  });
});

describe('cancellationComment', () => {
  function roundTrip(details: Parameters<typeof cancellationComment>[0]) {
    const comment = cancellationComment(details);
    return mapCancellationDetails({
      cancellation_details: {
        comment,
        feedback: null,
        feedback_option: null,
        reason: 'cancellation_requested',
      },
    });
  }

  it('carries the resubscribe intent through Stripe and back', () => {
    expect(roundTrip({ comment: 'Back in spring', resubscribeIntent: 'maybe' })).toMatchObject({
      comment: 'Back in spring',
      resubscribeIntent: 'maybe',
    });
    expect(roundTrip({ comment: null, resubscribeIntent: 'no' })).toMatchObject({
      comment: null,
      resubscribeIntent: 'no',
    });
  });

  it('leaves a comment alone when no intent was given or the prefix is not one', () => {
    expect(roundTrip({ comment: 'Too pricey' })).not.toHaveProperty('resubscribeIntent');
    expect(roundTrip({ comment: '[note] keep me' })).toMatchObject({ comment: '[note] keep me' });
  });
});
