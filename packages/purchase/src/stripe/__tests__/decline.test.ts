import { describe, expect, it } from 'vitest';
import { mapDecline } from '../decline';

describe('mapDecline', () => {
  it.each([
    ['insufficient_funds', 'INSUFFICIENT_FUNDS'],
    ['expired_card', 'CARD_EXPIRED'],
    ['incorrect_cvc', 'CARD_INVALID'],
    ['invalid_expiry_year', 'CARD_INVALID'],
    ['try_again_later', 'PROCESSING_ERROR'],
    ['do_not_honor', 'DECLINED'],
    ['fraudulent', 'DECLINED'],
  ] as const)('reads decline code %s as %s', (code, reason) => {
    expect(mapDecline({ decline_code: code, message: 'Your card was declined.' })).toEqual({
      reason,
      code,
      message: 'Your card was declined.',
    });
  });

  it('falls back to the error code when the decline code is empty, as stripe-node leaves it', () => {
    expect(mapDecline({ code: 'expired_card', decline_code: '' })).toEqual({
      reason: 'CARD_EXPIRED',
      code: 'expired_card',
      message: null,
    });
  });

  it('is a plain decline without any failure details', () => {
    expect(mapDecline(null)).toEqual({ reason: 'DECLINED', code: null, message: null });
    expect(mapDecline(undefined)).toEqual({ reason: 'DECLINED', code: null, message: null });
  });
});
