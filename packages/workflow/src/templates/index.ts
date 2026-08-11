import { template } from '../dsl';
import type { UserProperty } from '../schema';

/**
 * Message templates: top-level named assets. The props shape is declared here
 * and checked at every use site. The key maps to content in the template
 * system (liquid, react-email, …), which is a separate topic.
 */

/** U1 (T+1h, abandoned upgrade): one email, no discount, spelling out what the higher plan unlocks. */
export const upgradeRecovery = template.email<{
  plan: UserProperty['subscription_plan'];
}>('u1_upgrade_recovery');

/** N1 (T+1h, abandoned first purchase): no discount — a low-friction reminder plus reassurance. */
export const firstTimeRecovery = template.email('n1_first_time_recovery');

/** N2 (T+24h, first-time buyers only): the closer — a 15% code expiring in 48h. */
export const limitedTimeOffer = template.email<{
  coupon: string;
  expiresIn: string;
}>('n2_limited_time_offer');

/** Onboarding: getting started. */
export const gettingStarted = template.email('onboarding_getting_started');

/** Onboarding: pro tips, for already-active users. */
export const proTips = template.email('onboarding_pro_tips');
