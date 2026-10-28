import type { Stripe } from 'stripe';

/**
 * Reusable payment methods whose outcome arrives days after the charge is attempted: Stripe's
 * "payment methods with delayed notification" (https://docs.stripe.com/payments/payment-methods#payment-notification).
 * A charge to one sits in `processing` until the bank answers, and can still fail then.
 *
 * Only types that can be saved and charged again (a subscription's or customer's default) are
 * listed: the bank debits. One-off vouchers and transfers (Boleto, OXXO, Konbini, bank transfers)
 * also notify late, but never come back as a saved payment method. A deny-list, so instant methods
 * (cards, wallets, Link, PayPal, ...) need no entry; a delayed type Stripe adds later has to be
 * added here.
 */
export const DELAYED_NOTIFICATION_PAYMENT_METHOD_TYPES: ReadonlySet<Stripe.PaymentMethod.Type> =
  new Set([
    'sepa_debit',
    'us_bank_account',
    'bacs_debit',
    'au_becs_debit',
    'acss_debit',
    'nz_bank_account',
  ]);

/**
 * Whether a charge to this payment method type is only known to have succeeded days later. Flows
 * that need the money now (a Stripe pending update, which supports no such method and expires
 * after ~23 hours) should refuse it up front rather than report a late failure.
 */
export function hasDelayedNotification(type: Stripe.PaymentMethod.Type): boolean {
  return DELAYED_NOTIFICATION_PAYMENT_METHOD_TYPES.has(type);
}
