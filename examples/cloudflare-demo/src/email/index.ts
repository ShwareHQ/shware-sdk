import offer from './offer';
import welcome from './welcome';

/**
 * Email registry: the single place templates are registered. Its keys are the
 * DSL's `t.email.<key>` (src/templates.ts) — referencing an unregistered key
 * simply does not compile, so no test is needed to catch it.
 */
export const email = {
  demo_welcome: welcome,
  demo_offer: offer,
} as const;
