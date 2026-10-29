import {
  _default,
  enum as _enum,
  gte,
  int,
  lte,
  maxLength,
  nullable,
  object,
  optional,
  refine,
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

/** At least one origin: an empty list would refuse every return URL. */
export type AllowedOrigins = readonly [string, ...string[]];

/**
 * Normalizes each allowed origin with `new URL()`, so `https://example.com/` and
 * `https://example.com` are the same entry. Throws on anything that is not an http(s) origin: a
 * misconfigured list must fail at startup, not let every return URL through or refuse them all.
 */
function normalizeOrigins(origins: AllowedOrigins): string[] {
  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`returnUrl: ${origin} is not an http(s) origin`);
    }
    return parsed.origin;
  });
}

/**
 * Whether `value` may be handed to Stripe as a URL its hosted pages (Checkout, the billing portal)
 * send the browser back to. Origins are compared as parsed by `new URL()`, never by string prefix,
 * so a lookalike host (`https://example.com.evil.com`), userinfo (`https://example.com@evil.com`),
 * protocol-relative (`//evil.com`) and `javascript:` values are all refused. The scheme is part of
 * the origin, so an https-only list refuses `http:` too.
 */
function isAllowedReturnUrl(value: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  return allowedOrigins.includes(parsed.origin);
}

/**
 * A client-supplied return / success / cancel URL. It goes straight to Stripe, so without an
 * origin check anyone could create a session with their own account and hand out a
 * `checkout.stripe.com` / `billing.stripe.com` link that ends on a page of their choosing: an open
 * redirect behind a trusted domain. `allowedOrigins` is usually just the web app's origin.
 */
export function returnUrlSchema(allowedOrigins: AllowedOrigins) {
  const origins = normalizeOrigins(allowedOrigins);
  return url().check(
    refine((value) => isAllowedReturnUrl(value, origins), {
      message: `URL must be on ${origins.join(', ')}`,
    })
  );
}

export interface CreateCheckoutSessionSchemaOptions {
  /** Origins (`https://example.com`) `cancelUrl` and `successUrl` may point at; see `returnUrlSchema`. */
  allowedOrigins: AllowedOrigins;
}

export function createCheckoutSessionSchema(
  productIds: string[],
  { allowedOrigins }: CreateCheckoutSessionSchemaOptions
) {
  return object({
    quantity: _default(int().check(gte(1), lte(100)), 1),
    productId: _enum(productIds),
    cancelUrl: optional(returnUrlSchema(allowedOrigins)),
    successUrl: optional(returnUrlSchema(allowedOrigins)),
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
