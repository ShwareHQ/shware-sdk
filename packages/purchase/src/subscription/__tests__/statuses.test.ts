import { describe, expect, it } from 'vitest';
import { AVAILABLE_STATUSES, SUBSCRIPTION_STATUSES } from '../index';

describe('AVAILABLE_STATUSES', () => {
  it('keeps access through a retry the customer is served through, and not past it', () => {
    expect([...AVAILABLE_STATUSES].sort()).toEqual(
      ['ACTIVE', 'IN_GRACE_PERIOD', 'PAST_DUE', 'TRIALING'].sort()
    );
    // The store has given up, or retries without serving the customer.
    for (const status of ['UNPAID', 'ON_HOLD', 'PAUSED', 'CANCELED', 'EXPIRED'] as const) {
      expect(AVAILABLE_STATUSES).not.toContain(status);
    }
  });

  it('only names declared statuses', () => {
    for (const status of AVAILABLE_STATUSES) expect(SUBSCRIPTION_STATUSES).toContain(status);
  });
});
