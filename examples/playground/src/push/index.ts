import checkoutReminder from './checkout-reminder';
import christmasPromo from './christmas-promo';
import comeback from './comeback';
import finalOffer from './final-offer';
import firstDoc from './first-doc';

/**
 * Push registry: every entry is a `pushTemplate({...})`, sent as `push.<name>`
 * — the same contract as the email registry. The studio previews each entry as an iOS
 * and an Android notification.
 */
export const push = {
  checkoutReminder,
  christmasPromo,
  firstDoc,
  comeback,
  finalOffer,
} as const;
