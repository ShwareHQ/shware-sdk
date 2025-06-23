import type Stripe from 'stripe';
import { SubscriptionStatus } from '../subscription/index';

export const METADATA_KEYS = {
  USER_ID: 'user_id',
  PRODUCT_ID: 'product_id',
} as const;

export type ProductId = Lowercase<string>;
export type PriceId = `price_${string}`;

export interface Config {
  returnUrl: string;
  cancelUrl: string;
  successUrl: `${string}?session_id={CHECKOUT_SESSION_ID}`;
  allowPromotionCodes: boolean;
  payments: Record<ProductId, PriceId>;
  subscriptions: Record<ProductId, PriceId>;
}

export function mapTime<T extends number | null>(
  stripeTimestampSeconds: T
): T extends number ? string : null {
  if (!stripeTimestampSeconds) return null as T extends number ? string : null;
  return new Date(stripeTimestampSeconds * 1000).toISOString() as T extends number ? string : null;
}

export function mapCheckoutSession(session: Stripe.Checkout.Session) {
  return {
    id: session.id,
    url: session.url,
    livemode: session.livemode,
    expires_at: session.expires_at,
    payment_status: session.payment_status,
    currency: session.currency,
    amount_total: session.amount_total,
    line_items:
      session.line_items?.data.map((item) => ({
        id: item.id,
        currency: item.currency,
        quantity: item.quantity,
        description: item.description,
        amount_tax: item.amount_tax,
        amount_total: item.amount_total,
        amount_subtotal: item.amount_subtotal,
        amount_discount: item.amount_discount,
        price: item.price ? { id: item.price.id } : null,
      })) ?? [],
  };
}

export function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    case 'incomplete':
      return SubscriptionStatus.INCOMPLETE;
    case 'incomplete_expired':
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'paused':
      return SubscriptionStatus.PAUSED;
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'unpaid':
      return SubscriptionStatus.UNPAID;
    default: {
      console.error(`Invalid stripe status: ${status}`);
      throw new Error(`Invalid stripe status: ${status}`);
    }
  }
}
