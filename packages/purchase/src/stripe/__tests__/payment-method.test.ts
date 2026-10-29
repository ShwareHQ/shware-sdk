import type { Stripe } from 'stripe';
import { describe, expect, it } from 'vitest';
import { hasDelayedNotification, mapPaymentMethod } from '../payment-method';

describe('hasDelayedNotification', () => {
  it.each(['sepa_debit', 'us_bank_account', 'bacs_debit', 'au_becs_debit', 'acss_debit'] as const)(
    'is true for the bank debit %s',
    (type) => {
      expect(hasDelayedNotification(type)).toBe(true);
    }
  );

  it.each(['card', 'link', 'paypal'] as const)('is false for the instant method %s', (type) => {
    expect(hasDelayedNotification(type)).toBe(false);
  });
});

describe('mapPaymentMethod', () => {
  const card = {
    id: 'pm_card',
    type: 'card',
    card: {
      brand: 'visa',
      display_brand: 'cartes_bancaires',
      last4: '4242',
      exp_month: 4,
      exp_year: 2030,
    },
  } as unknown as Stripe.PaymentMethod;

  it('summarizes a card under its display brand, with the default flag the host decided', () => {
    expect(mapPaymentMethod(card, true)).toEqual({
      id: 'pm_card',
      type: 'card',
      card: { brand: 'cartes_bancaires', last4: '4242', expMonth: 4, expYear: 2030 },
      isDefault: true,
    });
  });

  it('falls back to the brand without a display brand, and has no card for other types', () => {
    const plain = { ...card, card: { ...card.card, display_brand: null } } as Stripe.PaymentMethod;
    expect(mapPaymentMethod(plain, false).card?.brand).toBe('visa');
    const sepa = { id: 'pm_sepa', type: 'sepa_debit' } as Stripe.PaymentMethod;
    expect(mapPaymentMethod(sepa, false)).toEqual({
      id: 'pm_sepa',
      type: 'sepa_debit',
      card: null,
      isDefault: false,
    });
  });
});
