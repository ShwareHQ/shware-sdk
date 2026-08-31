import { describe, expect, it } from 'vitest';
import { getFirst } from './field';
import { stripeMinorUnits } from './stripe';

describe('getFirst', () => {
  it('unwraps arrays, passes scalars, drops empties', () => {
    expect(getFirst(['a', 'b'])).toBe('a');
    expect(getFirst('a')).toBe('a');
    expect(getFirst([])).toBeUndefined();
    expect(getFirst(undefined)).toBeUndefined();
  });
});

describe('stripeMinorUnits', () => {
  it('is 1 for zero-decimal currencies, case-insensitively, else 100', () => {
    expect(stripeMinorUnits('JPY')).toBe(1);
    expect(stripeMinorUnits('krw')).toBe(1);
    expect(stripeMinorUnits('USD')).toBe(100);
    expect(stripeMinorUnits('eur')).toBe(100);
  });
});
