import { describe, expect, it } from 'vitest';
import { mapCancellationDetails, mapGraceUntil, mapPaymentType, mapSubscription } from '../mapper';

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

describe('mapPaymentType', () => {
  it.each([
    [{ notificationType: 'SUBSCRIBED', subtype: 'INITIAL_BUY' }, 'SUBSCRIPTION_START'],
    [{ notificationType: 'SUBSCRIBED', subtype: 'RESUBSCRIBE' }, 'SUBSCRIPTION_START'],
    [{ notificationType: 'DID_RENEW' }, 'SUBSCRIPTION_RENEWAL'],
    [{ notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'UPGRADE' }, 'SUBSCRIPTION_UPDATE'],
    [{ notificationType: 'OFFER_REDEEMED', subtype: 'INITIAL_BUY' }, 'SUBSCRIPTION_START'],
    [{ notificationType: 'OFFER_REDEEMED', subtype: 'RESUBSCRIBE' }, 'SUBSCRIPTION_START'],
    [{ notificationType: 'OFFER_REDEEMED', subtype: 'UPGRADE' }, 'SUBSCRIPTION_UPDATE'],
  ])('reads %o as %s', (source, type) => {
    expect(mapPaymentType(source)).toBe(type);
  });

  it.each([
    { notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'DOWNGRADE' },
    { notificationType: 'OFFER_REDEEMED', subtype: 'DOWNGRADE' },
    { notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED' },
    { notificationType: 'EXPIRED', subtype: 'VOLUNTARY' },
    { notificationType: 'REFUND' },
  ])('is no payment for %o', (source) => {
    expect(mapPaymentType(source)).toBeNull();
  });
});

describe('mapGraceUntil', () => {
  const graceEnd = Date.parse('2026-11-20T08:00:00Z');

  it('is the grace period end while the subscription is in it', () => {
    expect(mapGraceUntil({ status: 'IN_GRACE_PERIOD', gracePeriodExpiresDate: graceEnd })).toBe(
      '2026-11-20T08:00:00.000Z'
    );
  });

  it('is null in a billing retry without grace, or once the subscription recovered', () => {
    expect(mapGraceUntil({ status: 'BILLING_RETRY', gracePeriodExpiresDate: graceEnd })).toBeNull();
    expect(mapGraceUntil({ status: 'ACTIVE', gracePeriodExpiresDate: graceEnd })).toBeNull();
  });

  it('is null when Apple sent no date', () => {
    expect(mapGraceUntil({ status: 'IN_GRACE_PERIOD' })).toBeNull();
    expect(mapGraceUntil({ status: 'IN_GRACE_PERIOD', gracePeriodExpiresDate: null })).toBeNull();
  });
});

describe('mapSubscription', () => {
  const purchaseDate = Date.parse('2026-11-01T12:00:00Z');
  const expiresDate = Date.parse('2026-11-08T12:00:00Z');
  const paid = { purchaseDate, expiresDate, offerDiscountType: 'PAY_AS_YOU_GO' };
  const trial = { purchaseDate, expiresDate, offerDiscountType: 'FREE_TRIAL' };
  const renewing = { autoRenewStatus: 1 };

  it('reads an active, renewing subscription as active without a trial', () => {
    expect(mapSubscription({ status: 1, transaction: paid, renewalInfo: renewing })).toEqual({
      status: 'ACTIVE',
      autoRenewEnabled: true,
      trialStart: null,
      trialEnd: null,
    });
    // A full-price transaction redeemed no offer at all.
    expect(
      mapSubscription({
        status: 1,
        transaction: { purchaseDate, expiresDate },
        renewalInfo: renewing,
      })
    ).toMatchObject({ status: 'ACTIVE', trialStart: null });
  });

  it.each([
    [2, 'EXPIRED'],
    [3, 'BILLING_RETRY'],
    [4, 'IN_GRACE_PERIOD'],
    [5, 'CANCELED'],
  ])('maps status %i to %s', (status, mapped) => {
    expect(mapSubscription({ status, transaction: paid, renewalInfo: renewing })).toMatchObject({
      status: mapped,
    });
  });

  it('keeps a subscription with auto-renew off active until it expires', () => {
    expect(
      mapSubscription({ status: 1, transaction: paid, renewalInfo: { autoRenewStatus: 0 } })
    ).toEqual({ status: 'ACTIVE', autoRenewEnabled: false, trialStart: null, trialEnd: null });
  });

  it('is trialing, with the trial dates, while the latest transaction is a free trial', () => {
    expect(mapSubscription({ status: 1, transaction: trial, renewalInfo: renewing })).toEqual({
      status: 'TRIALING',
      autoRenewEnabled: true,
      trialStart: '2026-11-01T12:00:00.000Z',
      trialEnd: '2026-11-08T12:00:00.000Z',
    });
    // Cancelled during the trial: still trialing, not renewing.
    expect(
      mapSubscription({ status: 1, transaction: trial, renewalInfo: { autoRenewStatus: 0 } })
    ).toMatchObject({ status: 'TRIALING', autoRenewEnabled: false });
  });

  it('carries the trial dates but not the status through a billing retry or grace period', () => {
    expect(mapSubscription({ status: 4, transaction: trial, renewalInfo: renewing })).toMatchObject(
      {
        status: 'IN_GRACE_PERIOD',
        trialStart: '2026-11-01T12:00:00.000Z',
        trialEnd: '2026-11-08T12:00:00.000Z',
      }
    );
    expect(mapSubscription({ status: 3, transaction: trial, renewalInfo: renewing })).toMatchObject(
      {
        status: 'BILLING_RETRY',
        trialEnd: '2026-11-08T12:00:00.000Z',
      }
    );
  });

  it('renews into nothing once expired or revoked, whatever the renewal info says', () => {
    for (const status of [2, 5]) {
      expect(mapSubscription({ status, transaction: paid, renewalInfo: renewing })).toMatchObject({
        autoRenewEnabled: false,
      });
    }
  });

  it('throws for an unknown status', () => {
    expect(() => mapSubscription({ status: 9, transaction: paid, renewalInfo: renewing })).toThrow(
      'Unknown App Store subscription status: 9'
    );
    expect(() => mapSubscription({ transaction: paid, renewalInfo: renewing })).toThrow(
      'Unknown App Store subscription status: undefined'
    );
  });
});
