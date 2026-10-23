/**
 * Why a card was refused, in the few buckets a cardholder can act on. Everything else
 * (`do_not_honor`, `fraudulent`, `lost_card`, ...) is DECLINED, which is also what Stripe advises
 * telling the customer in those cases: https://docs.stripe.com/declines/codes
 *
 * - INSUFFICIENT_FUNDS: top up, or use another card.
 * - CARD_EXPIRED: update the card.
 * - CARD_INVALID: a mistyped number, expiry, CVC or postal code.
 * - PROCESSING_ERROR: a transient issuer or network problem; trying again may work.
 * - DECLINED: the bank said no without a reason the customer can fix.
 */
export const DECLINE_REASONS = [
  'INSUFFICIENT_FUNDS',
  'CARD_EXPIRED',
  'CARD_INVALID',
  'PROCESSING_ERROR',
  'DECLINED',
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

const REASON_BY_CODE: Partial<Record<string, DeclineReason>> = {
  insufficient_funds: 'INSUFFICIENT_FUNDS',
  expired_card: 'CARD_EXPIRED',
  incorrect_cvc: 'CARD_INVALID',
  invalid_cvc: 'CARD_INVALID',
  incorrect_number: 'CARD_INVALID',
  invalid_number: 'CARD_INVALID',
  invalid_expiry_month: 'CARD_INVALID',
  invalid_expiry_year: 'CARD_INVALID',
  incorrect_zip: 'CARD_INVALID',
  processing_error: 'PROCESSING_ERROR',
  try_again_later: 'PROCESSING_ERROR',
  issuer_not_available: 'PROCESSING_ERROR',
  reenter_transaction: 'PROCESSING_ERROR',
};

/**
 * A refused charge as Stripe describes it: the shape shared by `Stripe.errors.StripeCardError` and
 * `PaymentIntent.last_payment_error`.
 */
export type CardFailure =
  | { code?: string | null; decline_code?: string | null; message?: string | null }
  | null
  | undefined;

export interface Decline {
  reason: DeclineReason;
  /** Stripe's decline code (or error code when there is none), for logs and error metadata */
  code: string | null;
  /** Stripe's own message, for logs; not meant for the customer */
  message: string | null;
}

export function mapDecline(failure: CardFailure): Decline {
  // stripe-node fills `decline_code` with '' when the raw error has none, hence `||`.
  const code = failure?.decline_code || failure?.code || null;
  return {
    reason: (code && REASON_BY_CODE[code]) || 'DECLINED',
    code,
    message: failure?.message || null,
  };
}
