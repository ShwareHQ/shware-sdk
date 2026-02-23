import { type Stripe } from 'stripe';
import { SubscriptionStatus } from '../subscription/index';

export function mapTime<T extends number | null>(
  stripeTimestampSeconds: T
): T extends number ? string : null {
  if (!stripeTimestampSeconds) return null as T extends number ? string : null;
  return new Date(stripeTimestampSeconds * 1000).toISOString() as T extends number ? string : null;
}

export function mapPrice(price: Stripe.Price) {
  return {
    id: price.id,
    type: price.type,
    active: price.active,
    billing_scheme: price.billing_scheme,
    currency: price.currency,
    unit_amount: price.unit_amount,
    unit_amount_decimal: price.unit_amount_decimal,
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

export function getPurchaseProperties(session: CheckoutSession): PurchaseProperties {
  let value: number;
  let currency: string;
  if (!session.amount_total || !session.currency) {
    value = session.line_items?.reduce((acc, item) => acc + (item.amount_total ?? 0), 0) ?? 0;
    currency = session.line_items?.[0]?.currency ?? 'usd';
  } else {
    value = session.amount_total;
    currency = session.currency;
  }

  return {
    transaction_id: session.id,
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
