import {
  _default,
  enum as _enum,
  gte,
  int,
  maxLength,
  nullable,
  object,
  optional,
  string,
  url,
} from 'zod/mini';
import { CANCELLATION_FEEDBACKS, RESUBSCRIBE_INTENTS } from '../subscription/index';

/** What our own cancel dialog may send along with a cancellation (see `CancellationDetails`). */
export const cancellationDetailsSchema = object({
  comment: optional(nullable(string().check(maxLength(1024)))),
  feedback: optional(nullable(_enum(CANCELLATION_FEEDBACKS))),
  resubscribeIntent: optional(nullable(_enum(RESUBSCRIBE_INTENTS))),
});

export function createCheckoutSessionSchema(productIds: string[]) {
  return object({
    quantity: _default(int().check(gte(1)), 1),
    productId: _enum(productIds),
    cancelUrl: optional(url()),
    successUrl: optional(url()),
  });
}

// Kept under the stripe entry for callers that imported it from here; the type is platform
// neutral and lives with the subscription statuses.
export type { CancellationDetails } from '../subscription/index';

export interface CreateCheckoutSessionDTO {
  productId: string;
  cancelUrl?: string;
  successUrl?: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
}
