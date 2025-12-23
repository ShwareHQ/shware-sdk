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
});

export function createCheckoutSessionSchema(productIds: string[]) {
  return object({
    quantity: _default(int().check(gte(1)), 1),
    productId: _enum(productIds),
    cancelUrl: optional(url()),
    successUrl: optional(url()),
  });
}

export interface CancellationDetails extends output<typeof cancellationDetailsSchema> {
  reason?: 'cancellation_requested' | 'payment_disputed' | 'payment_failed' | null;
}

export interface CreateCheckoutSessionDTO {
  productId: string;
  cancelUrl?: string;
  successUrl?: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
}
