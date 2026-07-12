import { describe, expect, it } from 'vitest';
import { mapSubscriptionStatus } from '../mapper';

describe('mapSubscriptionStatus', () => {
  it('should map every google play state to a subscription status', () => {
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_PENDING')).toBe('PENDING');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_ACTIVE')).toBe('ACTIVE');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_PAUSED')).toBe('PAUSED');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_IN_GRACE_PERIOD')).toBe('IN_GRACE_PERIOD');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_ON_HOLD')).toBe('ON_HOLD');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_CANCELED')).toBe('CANCELED');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_EXPIRED')).toBe('EXPIRED');
    expect(mapSubscriptionStatus('SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED')).toBe(
      'PENDING_PURCHASE_CANCELED'
    );
  });

  it('should throw for unmapped states', () => {
    expect(() => mapSubscriptionStatus('SUBSCRIPTION_STATE_UNSPECIFIED')).toThrow(
      'Unknown Google Play subscription state: SUBSCRIPTION_STATE_UNSPECIFIED'
    );
  });
});
