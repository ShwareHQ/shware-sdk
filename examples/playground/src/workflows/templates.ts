import { template } from '@shware/workflow';
import type { UserProperty } from './schema';

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

/* ------- Push companions: same key contract as emails; content lives in src/pushes/ ------- */

/** U1's lock-screen twin: lands with the email, so the nudge is seen even when the inbox is not. */
export const checkoutReminderPush = template.push('checkout_reminder_push');

/** Onboarding: for sign-ups still without a document once the activation wait runs out. */
export const firstDocPush = template.push('onboarding_first_doc_push');

/** Christmas: the promo on the lock screen. The coupon is a prop, so the code is not baked into content. */
export const christmasPush = template.push<{ coupon: string }>('christmas_promo_push');

/* ------- Community channels: an internal audience the inbox cannot reach ------- */

/** Announced in the community server the day someone signs up; content lives in src/discord/. */
export const communityWelcome = template.discord('community_welcome');
