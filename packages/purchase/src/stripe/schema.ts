import type { Stripe } from 'stripe';
import {
  _default,
  enum as _enum,
  gte,
  int,
  maxLength,
  nullable,
  object,
  optional,
  type output,
  string,
  url,
} from 'zod/mini';

export const cancellationDetailsSchema = object({
  comment: optional(nullable(string().check(maxLength(1024)))),
  feedback: optional(
    nullable(
      _enum([
        'customer_service',
        'low_quality',
        'missing_features',
        'switched_service',
        'too_complex',
        'too_expensive',
        'unused',
        'other',
      ])
    )
  ),
  resubscribeIntent: optional(nullable(_enum(['maybe', 'no', 'yes']))),
});

export function createCheckoutSessionSchema(productIds: string[]) {
  return object({
    quantity: _default(int().check(gte(1)), 1),
    productId: _enum(productIds),
    cancelUrl: optional(url()),
    successUrl: optional(url()),
  });
}

// The schema validates what a client may send; this is the stored/returned shape,
// so `feedback` and `reason` take stripe's own open-ended enums — since 22.4 both
// carry `OtherString`, and a Subscription.cancellation_details is assigned here
// verbatim.
export interface CancellationDetails extends Omit<
  output<typeof cancellationDetailsSchema>,
  'feedback'
> {
  feedback?: Stripe.Subscription.CancellationDetails.Feedback | null;
  reason?: Stripe.Subscription.CancellationDetails.Reason | null;
}

export interface CreateCheckoutSessionDTO {
  productId: string;
  cancelUrl?: string;
  successUrl?: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
}
