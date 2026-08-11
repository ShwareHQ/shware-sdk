import * as offer from './offer';
import * as welcome from './welcome';

/**
 * Email registry: the single place templates are registered.
 * Keys are defined here, and the DSL's `templates<Emails>()` checks against
 * them at compile time — referencing an unregistered key simply does not
 * compile, so no test is needed to catch it.
 */
export const emails = {
  demo_welcome: welcome,
  demo_offer: offer,
} as const;

export type Emails = typeof emails;
export type EmailKey = keyof Emails;
