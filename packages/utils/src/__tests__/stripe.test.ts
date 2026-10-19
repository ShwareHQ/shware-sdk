import { describe, expect, it } from 'vitest';
import { stripeMinorUnits } from '../stripe';

describe('stripeMinorUnits', () => {
  it('counts zero-decimal currencies in whole units', () => {
    expect(stripeMinorUnits('JPY')).toBe(1);
    expect(stripeMinorUnits('krw')).toBe(1);
  });

  it('counts three-decimal currencies in thousandths', () => {
    for (const code of ['BHD', 'JOD', 'KWD', 'OMR', 'TND']) {
      expect(stripeMinorUnits(code)).toBe(1000);
    }
    expect(stripeMinorUnits('kwd')).toBe(1000);
  });

  it('keeps ISK and UGX two-decimal, as the Stripe API represents them', () => {
    expect(stripeMinorUnits('ISK')).toBe(100);
    expect(stripeMinorUnits('ugx')).toBe(100);
  });

  it('defaults to two decimals', () => {
    expect(stripeMinorUnits('USD')).toBe(100);
    expect(stripeMinorUnits('eur')).toBe(100);
  });
});
