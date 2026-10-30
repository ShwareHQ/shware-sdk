import { stripeMinorUnits } from '@shware/utils';
import type { Stripe } from 'stripe';
import {
  CANCELLATION_FEEDBACKS,
  type CancellationDetails,
  type CancellationFeedback,
  DISPUTE_STATUSES,
  type DisputeStatus,
  type PaymentType,
  RESUBSCRIBE_INTENTS,
  type RefundStatus,
  type ResubscribeIntent,
  type SubscriptionStatus,
} from '../subscription/index';
import type { CustomerType } from '../types';

type MappedTime<T> = T extends number ? string : null;

/**
 * A Stripe timestamp (seconds) as an ISO string; a missing one (`null` / `undefined`) stays `null`.
 * `0` is a real time (the epoch), not a missing one.
 */
export function mapTime<T extends number | null | undefined>(
  stripeTimestampSeconds: T
): MappedTime<T> {
  if (typeof stripeTimestampSeconds !== 'number') return null as MappedTime<T>;
  return new Date(stripeTimestampSeconds * 1000).toISOString() as MappedTime<T>;
}

export type Price = {
  id: string;
  type: Stripe.Price.Type;
  active: boolean;
  billing_scheme: Stripe.Price.BillingScheme;
  currency: Stripe.Price['currency'];
  unit_amount: number | null;
  unit_amount_decimal: string | null;
  recurring: Stripe.Price.Recurring | null;
};

export function mapPrice(price: Stripe.Price): Price {
  return {
    id: price.id,
    type: price.type,
    active: price.active,
    billing_scheme: price.billing_scheme,
    currency: price.currency,
    unit_amount: price.unit_amount,
    unit_amount_decimal: price.unit_amount_decimal?.toString() ?? null,
    recurring: price.recurring,
  };
}

export interface LineItem {
  id: string;
  currency: string;
  quantity: number | null;
  description: string | null;
  amount_tax: number;
  amount_total: number;
  amount_subtotal: number;
  amount_discount: number;
  price: Price | null;
}

export function mapLineItem(item: Stripe.LineItem): LineItem {
  return {
    id: item.price
      ? typeof item.price.product === 'string'
        ? item.price.product
        : item.price.product.id
      : item.id,
    currency: item.currency,
    quantity: item.quantity,
    description: item.description,
    amount_tax: item.amount_tax,
    amount_total: item.amount_total,
    amount_subtotal: item.amount_subtotal,
    amount_discount: item.amount_discount,
    price: item.price ? mapPrice(item.price) : null,
  };
}

// Re-exported under our own name so consumers need not reach into stripe's namespace.
// Open-ended since stripe 22.4: a status the API adds later is not a type error.
export type PaymentStatus = Stripe.Checkout.Session.PaymentStatus;

// Declared rather than inferred from mapCheckoutSession: an inferred shape is
// structural, so a consumer's declaration emit has to spell out payment_status
// through stripe's internal module path — TS2883 in any package that reaches
// stripe transitively instead of depending on it (see line_items/price too).
export interface CheckoutSession {
  id: string;
  url: string | null;
  coupon: string | undefined;
  livemode: boolean;
  expires_at: number;
  payment_status: PaymentStatus;
  currency: string | null;
  amount_total: number | null;
  line_items: LineItem[] | undefined;
  /**
   * Not on the Stripe object: the host sets it from its own records when it answers the session
   * to a client (`{ ...mapCheckoutSession(session), customer_type }`), and `getPurchaseProperties`
   * carries it into the `purchase` event. Left out when the host cannot tell (a guest checkout).
   */
  customer_type?: CustomerType;
}

export function mapCheckoutSession(session: Stripe.Checkout.Session): CheckoutSession {
  let coupon: string | undefined = undefined;
  if (Array.isArray(session.discounts) && session.discounts.length !== 0) {
    const discount = session.discounts[0];
    if (discount.coupon && typeof discount.coupon === 'object') {
      coupon = discount.coupon.id;
    } else if (typeof discount.coupon === 'string') {
      coupon = discount.coupon;
    } else {
      coupon = undefined;
    }
  }

  return {
    id: session.id,
    url: session.url,
    coupon,
    livemode: session.livemode,
    expires_at: session.expires_at,
    payment_status: session.payment_status,
    currency: session.currency,
    amount_total: session.amount_total,
    line_items: session.line_items?.data.map(mapLineItem),
  };
}

export function mapInvoice(i: Stripe.Invoice) {
  return {
    id: i.id,
    number: i.number,
    total: i.total,
    subtotal: i.subtotal,
    amount_due: i.amount_due,
    amount_paid: i.amount_paid,
    amount_remaining: i.amount_remaining,
    currency: i.currency,
    billing_reason: i.billing_reason,
    hosted_invoice_url: i.hosted_invoice_url,
    invoice_pdf: i.invoice_pdf,
    receipt_number: i.receipt_number,
    status: i.status,
    created: i.created,
    period_start: i.period_start,
    period_end: i.period_end,
  };
}

export type PaymentIntentStatus = Stripe.PaymentIntent.Status;

// Declared, not inferred, for the same reason as CheckoutSession: `status` must not make a
// consumer's declaration emit reach into stripe's module paths.
export interface PaymentIntent {
  id: string;
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  client_secret: string | null;
  description: string | null;
  status: PaymentIntentStatus;
  created: number;
}

export function mapPaymentIntent(intent: Stripe.PaymentIntent): PaymentIntent {
  return {
    id: intent.id,
    amount: intent.amount,
    amount_capturable: intent.amount_capturable,
    amount_received: intent.amount_received,
    currency: intent.currency,
    client_secret: intent.client_secret,
    description: intent.description,
    status: intent.status,
    created: intent.created,
  };
}

export type ChargeStatus = Stripe.Charge.Status;

/** A charge as the host lists it to a client (a billing history page). */
export interface Charge {
  id: string;
  description: string | null;
  currency: string;
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  receipt_email: string | null;
  receipt_number: string | null;
  receipt_url: string | null;
  status: ChargeStatus;
  created: number;
  /** Only when the charge was listed with `payment_intent` expanded. */
  payment_intent?: PaymentIntent;
}

export function mapCharge(charge: Stripe.Charge): Charge {
  return {
    id: charge.id,
    description: charge.description,
    currency: charge.currency,
    amount: charge.amount,
    amount_captured: charge.amount_captured,
    amount_refunded: charge.amount_refunded,
    receipt_email: charge.receipt_email,
    receipt_number: charge.receipt_number,
    receipt_url: charge.receipt_url,
    status: charge.status,
    created: charge.created,
    payment_intent:
      charge.payment_intent && typeof charge.payment_intent === 'object'
        ? mapPaymentIntent(charge.payment_intent)
        : undefined,
  };
}

export type ProductPrice = {
  id: string;
  type: Stripe.Price.Type;
  unit_amount: number;
  currency: Stripe.Price['currency'];
  product: {
    id: Stripe.Product['id'];
    name: Stripe.Product['name'];
    description: Stripe.Product['description'];
    livemode: Stripe.Product['livemode'];
  };
};

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'canceled':
      return 'CANCELED';
    case 'incomplete':
      return 'INCOMPLETE';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    case 'past_due':
      return 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    case 'trialing':
      return 'TRIALING';
    case 'unpaid':
      return 'UNPAID';
    default: {
      console.error(`Invalid stripe status: ${String(status)}`);
      throw new Error(`Invalid stripe status: ${String(status)}`);
    }
  }
}

/**
 * What a paid subscription invoice was for, by its `billing_reason`. Only `subscription_cycle` is
 * a renewal: a plan change invoices its proration mid-period (`subscription_update`), and counting
 * that as a renewal would inflate the renewal rate by every upgrade.
 */
export function mapPaymentType(
  invoice: Pick<Stripe.Invoice, 'id' | 'billing_reason'>
): Exclude<PaymentType, 'ONE_TIME'> {
  switch (invoice.billing_reason) {
    // Exactly once per subscription: its first invoice (after a trial, the first paid one is a cycle).
    case 'subscription_create':
      return 'SUBSCRIPTION_START';
    case 'subscription_cycle':
      return 'SUBSCRIPTION_RENEWAL';
    case 'subscription_update':
      return 'SUBSCRIPTION_UPDATE';
    // An invoice made by hand on the subscription (dashboard or API): off-cycle money, not a renewal.
    case 'manual':
      return 'SUBSCRIPTION_UPDATE';
    default:
      // subscription_threshold (metered billing) and the rest are not reasons flat-priced
      // subscriptions produce. Off-cycle is the safe reading: it leaves renewals alone.
      console.warn(`Invoice ${invoice.id} has billing_reason ${invoice.billing_reason}`);
      return 'SUBSCRIPTION_UPDATE';
  }
}

/** `refund.status` is an untyped string in stripe-node; these are the documented values. */
const REFUND_STATUS: Partial<Record<string, RefundStatus>> = {
  pending: 'PENDING',
  requires_action: 'PENDING',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  canceled: 'CANCELED',
};

/** A Stripe refund's status; a refund that has none yet is pending. Throws on an unknown one. */
export function mapRefundStatus(refund: Pick<Stripe.Refund, 'id' | 'status'>): RefundStatus {
  const status = REFUND_STATUS[refund.status ?? 'pending'];
  if (!status) throw new Error(`Unknown refund status ${refund.status}: ${refund.id}`);
  return status;
}

/** A Stripe dispute's status, upper-cased into {@link DISPUTE_STATUSES}. Throws on an unknown one. */
export function mapDisputeStatus(dispute: Pick<Stripe.Dispute, 'id' | 'status'>): DisputeStatus {
  const status = dispute.status.toUpperCase();
  const known = DISPUTE_STATUSES.find((item) => item === status);
  if (!known) throw new Error(`Unknown dispute status ${dispute.status}: ${dispute.id}`);
  return known;
}

export { ZERO_DECIMAL_CURRENCIES } from '@shware/utils';

/** How many Stripe API amount units make one unit of `currency` (1, 100 or 1000). */
export function minorUnits(currency: string) {
  return stripeMinorUnits(currency);
}

export function price(value: number, currency: string) {
  return value / minorUnits(currency);
}

export type Money = { amount: number; currency: string };

/** A Stripe amount in minor units (cents, yen, fils) as an amount in `currency` itself. */
export function money(value: number, currency: string): Money {
  return { amount: price(value, currency), currency };
}

export interface Item {
  item_id: string;
  item_name: string;
  affiliation?: 'Google Store' | (string & {});
  coupon?: string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  quantity?: number;
}

export interface PurchaseProperties {
  currency: string;
  value: number;
  transaction_id: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
  items?: Item[];
  /** From `CheckoutSession.customer_type`, when the host set it. */
  customer_type?: CustomerType;
}

export interface BeginCheckoutProperties {
  currency: string;
  value: number;
  coupon?: string;
  items: Item[];
}

// Google Ads rejects conversion transaction IDs longer than 64 characters.
// https://support.google.com/google-ads/answer/6386790
const GOOGLE_ADS_TRANSACTION_ID_MAX = 64;

/**
 * GA4 purchase events feed Google Ads conversions, whose transaction IDs are
 * capped at 64 characters — but Stripe checkout session ids exceed that:
 * around 2021 they grew from ~32 chars (`cs_live_` + 24 random chars) to ~66
 * (`cs_live_a` + 57), with no announcement. Stripe treats id length/format as
 * opaque and backwards-compatible, guaranteeing only that ids never exceed
 * 255 chars, so they may grow again at any time.
 *
 * Dropping the fixed `cs_live_`/`cs_test_` prefix brings the id under 64
 * while staying reversible: prepend the prefix (livemode tells which) to
 * reconstruct the full session id for Stripe dashboard lookups. The payment
 * intent id (~27 chars) is not a substitute — it only exists on
 * `mode: 'payment'` sessions (subscription-mode sessions carry it on the
 * invoice instead), and its short length is just as unguaranteed as the
 * session id's was.
 *
 * Must stay deterministic: GA4/Google Ads dedupe purchases by
 * transaction_id, and the same session may be tracked from multiple paths.
 */
function toTransactionId(sessionId: string): string {
  const stripped = sessionId.replace(/^cs_(live|test)_/, '');
  if (stripped.length > GOOGLE_ADS_TRANSACTION_ID_MAX) {
    console.warn(
      `transaction_id still exceeds ${GOOGLE_ADS_TRANSACTION_ID_MAX} chars after stripping ` +
        `the prefix — Stripe may have lengthened session ids again; truncating: ${sessionId}`
    );
  }
  return stripped.slice(0, GOOGLE_ADS_TRANSACTION_ID_MAX);
}

export function getPurchaseProperties(session: CheckoutSession): PurchaseProperties {
  let value: number;
  let currency: string;
  if (!session.amount_total || !session.currency) {
    value = session.line_items?.reduce((acc, item) => acc + item.amount_total, 0) ?? 0;
    currency = session.line_items?.[0]?.currency ?? 'usd';
  } else {
    value = session.amount_total;
    currency = session.currency;
  }

  return {
    transaction_id: toTransactionId(session.id),
    value: price(value, currency),
    currency: currency.toUpperCase(),
    coupon: session.coupon,
    customer_type: session.customer_type,
    items: session.line_items?.map((item, index) => ({
      index,
      item_id: item.id,
      item_name: item.description ?? '',
      price: price(item.amount_total, item.currency),
      quantity: item.quantity ?? 1,
      discount: price(item.amount_discount, item.currency),
    })),
  };
}

export function getBeginCheckoutProperties(p: ProductPrice): BeginCheckoutProperties {
  return {
    currency: p.currency.toUpperCase(),
    value: price(p.unit_amount, p.currency),
    items: [
      {
        item_id: p.product.id,
        item_name: p.product.name,
        price: price(p.unit_amount, p.currency),
      },
    ],
  };
}

/**
 * The `cancellation_details.comment` to send Stripe for a cancel dialog's answers. Stripe stores
 * reason, feedback and comment, one field short of `resubscribeIntent`, so the intent travels as a
 * `[maybe]` / `[no]` / `[yes]` prefix on the comment, which {@link mapCancellationDetails} takes
 * back out.
 */
export function cancellationComment({
  comment,
  resubscribeIntent,
}: Pick<CancellationDetails, 'comment' | 'resubscribeIntent'>): string {
  return `${resubscribeIntent ? `[${resubscribeIntent}]` : ''}${comment ?? ''}`;
}

function parseCancellationComment(
  comment: string | null
): Pick<CancellationDetails, 'comment' | 'resubscribeIntent'> {
  const [, intent, rest] = (comment && /^\[(\w+)\](.*)$/s.exec(comment)) || [];
  if (!intent || !(RESUBSCRIBE_INTENTS as readonly string[]).includes(intent)) return { comment };
  return { comment: rest || null, resubscribeIntent: intent as ResubscribeIntent };
}

/**
 * Stripe's `cancellation_details` in the shared shape. The object is present on every
 * subscription with all three fields null, so an active one maps to null rather than an empty
 * record. `reason` says who acted: `cancellation_requested` is the customer (or us on their
 * behalf), the payment reasons are Stripe ending it. A comment written by
 * {@link cancellationComment} is split back into the comment and `resubscribeIntent`.
 */
export function mapCancellationDetails(
  subscription: Pick<Stripe.Subscription, 'cancellation_details'>
): CancellationDetails | null {
  const details = subscription.cancellation_details;
  if (!details || (!details.reason && !details.feedback && !details.comment)) return null;
  return {
    initiator:
      details.reason === 'payment_failed' || details.reason === 'payment_disputed'
        ? 'system'
        : 'user',
    reason: details.reason ?? null,
    // Stripe's feedback vocabulary is ours; anything it adds later is reported as "other".
    feedback: details.feedback
      ? (CANCELLATION_FEEDBACKS as readonly string[]).includes(details.feedback)
        ? (details.feedback as CancellationFeedback)
        : 'other'
      : null,
    ...parseCancellationComment(details.comment ?? null),
  };
}
