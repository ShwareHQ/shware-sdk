import type { StringValue } from 'ms';

export type Metadata = { credits: number; expiresIn: StringValue };

/**
 * GA4's `purchase.customer_type`: `new` for a first-time buyer, `returning` for one who bought
 * before, by the host's own definition (its payment history across every platform, its
 * acquisition window). Google Ads' new-customer acquisition goal reads it off the purchase
 * conversion. A host answers it with whatever tells a client a purchase went through: a Stripe
 * checkout session (`CheckoutSession.customer_type`), a store verification.
 */
export type CustomerType = 'new' | 'returning';

export type IsUnique<T extends readonly unknown[]> = T extends readonly [infer First, ...infer Rest]
  ? First extends Rest[number]
    ? false
    : IsUnique<Rest>
  : true;
