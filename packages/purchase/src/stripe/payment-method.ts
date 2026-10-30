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

export type PaymentMethodType = Stripe.PaymentMethod.Type;

/**
 * A saved payment method as the host lists it to a client; `card` is null for other types. Field
 * names are Stripe's, as in every mapper here.
 */
export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  /** The one the next invoice charges: the host decides (a subscription's or the customer's default). */
  is_default: boolean;
}

/**
 * `brand` is Stripe's `display_brand` when it has one (a co-badged card's chosen network, as
 * the customer sees it on the statement), else the card's `brand`.
 */
export function mapPaymentMethod(method: Stripe.PaymentMethod, is_default: boolean): PaymentMethod {
  return {
    id: method.id,
    type: method.type,
    card: method.card
      ? {
          brand: method.card.display_brand ?? method.card.brand,
          last4: method.card.last4,
          exp_month: method.card.exp_month,
          exp_year: method.card.exp_year,
        }
      : null,
    is_default,
  };
}
