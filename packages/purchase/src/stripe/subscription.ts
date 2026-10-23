import type { Stripe } from 'stripe';
import type { CancellationDetails, SubscriptionStatus } from '../subscription/index';
import {
  type Money,
  mapCancellationDetails,
  mapSubscriptionStatus,
  mapTime,
  money,
} from './mapper';

/**
 * A Stripe subscription in the platform-neutral shape a subscription row stores. What it leaves out
 * is the app's: who the user is and which plan the product means (both from the subscription's
 * metadata and the app's config), the row id, and when the row was written.
 */
export interface StripeSubscriptionState {
  status: SubscriptionStatus;
  autoRenewEnabled: boolean;
  /** see {@link mapListPrice}; null for a price without a flat amount */
  price: Money | null;
  startedAt: string;
  createdAt: string;
  /** null while paused: a paused subscription has no date it comes back on */
  renewalAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  canceledAt: string | null;
  cancellationDetails: CancellationDetails | null;
}

/**
 * The plan's list price, which is what "$X / month" promises. The latest invoice is deliberately
 * not used: after an upgrade it is the prorated difference, and after a coupon the discounted
 * amount, both of which belong in the invoice history rather than on the plan. Null for a tiered or
 * custom-amount price, which has no flat unit amount.
 */
export function mapListPrice({ items }: Pick<Stripe.Subscription, 'items'>): Money | null {
  const item = items.data.at(0);
  const price = item?.price;
  if (!price || price.unit_amount === null) return null;
  return money(price.unit_amount * (item.quantity ?? 1), price.currency);
}

export function mapSubscription(sub: Stripe.Subscription): StripeSubscriptionState {
  const periodEnd = sub.items.data.at(0)?.current_period_end ?? null;
  return {
    status: mapSubscriptionStatus(sub.status),
    autoRenewEnabled:
      sub.status !== 'canceled' && !sub.cancel_at_period_end && sub.cancel_at === null,
    price: mapListPrice(sub),
    startedAt: mapTime(sub.start_date),
    createdAt: mapTime(sub.created),
    // A paused subscription (trial ended without a card, failed payment, or an explicit pause;
    // `status_details.paused` says which) stays paused until it is resumed, so the period end it
    // still reports is not a renewal.
    renewalAt: sub.status === 'paused' ? null : mapTime(periodEnd),
    trialStart: mapTime(sub.trial_start),
    trialEnd: mapTime(sub.trial_end),
    canceledAt: mapTime(sub.canceled_at),
    cancellationDetails: mapCancellationDetails(sub),
  };
}
