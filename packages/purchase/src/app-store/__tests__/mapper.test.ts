import { describe, expect, it } from 'vitest';
import { mapCancellationDetails } from '../mapper';

describe('mapCancellationDetails', () => {
  it('is the user turning auto-renew off, and nothing when they turn it back on', () => {
    expect(
      mapCancellationDetails({
        notificationType: 'DID_CHANGE_RENEWAL_STATUS',
        subtype: 'AUTO_RENEW_DISABLED',
      })
    ).toEqual({ initiator: 'user', reason: 'AUTO_RENEW_DISABLED', feedback: null, comment: null });
    expect(
      mapCancellationDetails({
        notificationType: 'DID_CHANGE_RENEWAL_STATUS',
        subtype: 'AUTO_RENEW_ENABLED',
      })
    ).toBeNull();
  });

  it('reads who let an expired subscription lapse from the subtype or expirationIntent', () => {
    expect(
      mapCancellationDetails({ notificationType: 'EXPIRED', subtype: 'VOLUNTARY' })
    ).toMatchObject({
      initiator: 'user',
      reason: 'VOLUNTARY',
    });
    expect(
      mapCancellationDetails({ notificationType: 'EXPIRED', expirationIntent: 2 })
    ).toMatchObject({
      initiator: 'system',
      reason: 'BILLING_RETRY',
    });
    expect(
      mapCancellationDetails({ notificationType: 'EXPIRED', expirationIntent: 3 })
    ).toMatchObject({
      initiator: 'user',
      reason: 'PRICE_INCREASE',
    });
    expect(
      mapCancellationDetails({ notificationType: 'EXPIRED', expirationIntent: 4 })
    ).toMatchObject({
      initiator: 'developer',
      reason: 'PRODUCT_NOT_FOR_SALE',
    });
    expect(mapCancellationDetails({ notificationType: 'EXPIRED' })).toMatchObject({
      initiator: 'system',
      reason: 'EXPIRED',
    });
  });

  it('treats refunds, revocations and billing failures as the platform ending it', () => {
    for (const notificationType of [
      'REFUND',
      'REVOKE',
      'DID_FAIL_TO_RENEW',
      'GRACE_PERIOD_EXPIRED',
    ]) {
      expect(mapCancellationDetails({ notificationType })).toMatchObject({
        initiator: 'system',
        reason: notificationType,
      });
    }
  });

  it('is null for anything that is not a cancellation', () => {
    expect(mapCancellationDetails({ notificationType: 'DID_RENEW' })).toBeNull();
    expect(
      mapCancellationDetails({ notificationType: 'SUBSCRIBED', subtype: 'RESUBSCRIBE' })
    ).toBeNull();
  });
});
