import * as checkoutReminder from './checkout-reminder';
import * as christmasPromo from './christmas-promo';
import * as comeback from './comeback';
import * as finalOffer from './final-offer';
import * as firstDoc from './first-doc';

/**
 * Push registry: keys map one-to-one onto the DSL's template.push(key), the
 * same contract as the emails index. The studio previews each entry as an iOS
 * and an Android notification.
 */
export const pushes = {
  checkout_reminder_push: checkoutReminder,
  christmas_promo_push: christmasPromo,
  onboarding_first_doc_push: firstDoc,
  reengage_comeback_push: comeback,
  winback_final_offer_push: finalOffer,
} as const;

export type Pushes = typeof pushes;
