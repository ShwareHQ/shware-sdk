import { object, type output, string } from 'zod/mini';

/**
 * What an app sends to have a Play Billing purchase verified: the token names the purchase to
 * the Play Developer API, the product id says which catalogue entry (and so whether it is a
 * subscription or a one-time product) it should be.
 */
export const googlePlayPurchaseSchema = object({
  productId: string(),
  purchaseToken: string(),
});
export type GooglePlayPurchase = output<typeof googlePlayPurchaseSchema>;
