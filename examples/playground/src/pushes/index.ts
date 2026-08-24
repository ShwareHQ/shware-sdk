import * as comeback from './comeback';
import * as finalOffer from './final-offer';

/**
 * Push registry: keys map one-to-one onto the DSL's template.push(key), the
 * same contract as the emails index. The studio previews each entry as an iOS
 * and an Android notification.
 */
export const pushes = {
  reengage_comeback_push: comeback,
  winback_final_offer_push: finalOffer,
} as const;

export type Pushes = typeof pushes;
