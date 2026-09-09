import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getFirst } from './field';
import { sha256 } from './sha256';
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

describe('sha256', () => {
  it('matches the node:crypto digest the server-side senders produce', async () => {
    const expected = createHash('sha256').update('john@contoso.com').digest('hex');
    await expect(sha256('john@contoso.com')).resolves.toBe(expected);
    await expect(sha256('john@contoso.com')).resolves.toBe(
      'ec81f3ac7b2b19675bab9d54cf416f9f18cff87c97da5cca82c0f0891bc40602'
    );
  });
});
