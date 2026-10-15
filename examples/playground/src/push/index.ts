import checkoutReminder from './checkout-reminder';
import christmasPromo from './christmas-promo';
import comeback from './comeback';
import finalOffer from './final-offer';
import firstDoc from './first-doc';

/**
 * Push registry: every entry is a `pushTemplate({...})`, and its key is the
 * DSL's `t.push.<key>` — the same contract as the email registry. The studio previews each entry as an iOS
 * and an Android notification.
 */
export const push = {
  checkout_reminder_push: checkoutReminder,
  christmas_promo_push: christmasPromo,
  onboarding_first_doc_push: firstDoc,
  reengage_comeback_push: comeback,
  winback_final_offer_push: finalOffer,
} as const;
