import { type Stripe } from 'stripe';
import type { SubscriptionStatus } from '../subscription/index';

export function mapTime<T extends number | null>(
  stripeTimestampSeconds: T
): T extends number ? string : null {
  if (!stripeTimestampSeconds) return null as T extends number ? string : null;
  return new Date(stripeTimestampSeconds * 1000).toISOString() as T extends number ? string : null;
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

export function mapLineItem(item: Stripe.LineItem) {
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

export type PaymentStatus = 'no_payment_required' | 'paid' | 'unpaid';

export function mapCheckoutSession(session: Stripe.Checkout.Session) {
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

  // The variable annotation makes the emitted .d.ts reference the local
  // PaymentStatus alias instead of stripe's internal module path (TS2883)
  const payment_status: PaymentStatus = session.payment_status;

  return {
    id: session.id,
    url: session.url,
    coupon,
    livemode: session.livemode,
    expires_at: session.expires_at,
    payment_status,
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

export function mapPaymentIntent(intent: Stripe.PaymentIntent) {
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

export function mapCharge(charge: Stripe.Charge) {
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

export type CheckoutSession = ReturnType<typeof mapCheckoutSession>;
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

export const ZERO_DECIMAL_CURRENCIES = [
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
];

export function minorUnits(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase()) ? 1 : 100;
}

export function price(value: number, currency: string) {
  return value / minorUnits(currency);
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
