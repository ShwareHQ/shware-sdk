import { maxLength, object, optional, string, enum as _enum, url, type z } from 'zod/v4-mini';
import type { ProductId } from './types';

export const cancellationDetailsSchema = object({
  comment: optional(string().check(maxLength(1024))),
  feedback: optional(
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
  ),
});

export function checkoutSessionSchema(productIds: [ProductId, ...ProductId[]]) {
  return object({
    productId: _enum(productIds),
    cancelUrl: optional(url()),
    successUrl: optional(url()),
  });
}

export interface CancellationDetails extends z.output<typeof cancellationDetailsSchema> {
  reason?: 'cancellation_requested' | 'payment_disputed' | 'payment_failed';
}
