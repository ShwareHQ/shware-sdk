import { describe, expect, it } from 'vitest';
import { googlePlayPurchaseSchema } from '../schema';

describe('googlePlayPurchaseSchema', () => {
  it('needs both the product id and the purchase token', () => {
    expect(
      googlePlayPurchaseSchema.parse({ productId: 'pro_monthly', purchaseToken: 'tok' })
    ).toEqual({
      productId: 'pro_monthly',
      purchaseToken: 'tok',
    });
    expect(googlePlayPurchaseSchema.safeParse({ productId: 'pro_monthly' }).success).toBe(false);
    expect(googlePlayPurchaseSchema.safeParse({ purchaseToken: 'tok' }).success).toBe(false);
  });
});
