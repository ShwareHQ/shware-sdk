import { describe, expect, it } from 'vitest';
import { hasDelayedNotification } from '../payment-method';

describe('hasDelayedNotification', () => {
  it.each(['sepa_debit', 'us_bank_account', 'bacs_debit', 'au_becs_debit', 'acss_debit'] as const)(
    'is true for the bank debit %s',
    (type) => {
      expect(hasDelayedNotification(type)).toBe(true);
    }
  );

  it.each(['card', 'link', 'paypal'] as const)('is false for the instant method %s', (type) => {
    expect(hasDelayedNotification(type)).toBe(false);
  });
});
