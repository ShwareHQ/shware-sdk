import { describe, expect, it } from 'vitest';
import {
  type SubscriptionLineItem,
  type SubscriptionPurchase,
  mapCanceledAt,
  mapCancellationDetails,
  mapGraceUntil,
  mapPaymentType,
  mapSubscription,
} from '../mapper';

describe('mapSubscription', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const startTime = '2026-11-01T12:00:00.000Z';
  const future = '2026-11-20T08:00:00.000Z';
  const past = '2026-11-09T08:00:00.000Z';
  const item = (overrides: SubscriptionLineItem = {}): SubscriptionLineItem => ({
    expiryTime: future,
    autoRenewingPlan: { autoRenewEnabled: true },
    offerPhase: { basePrice: {} },
    ...overrides,
  });
  const purchase = (
    subscriptionState: string,
    lineItems: SubscriptionLineItem[] = [item()],
    rest: Omit<SubscriptionPurchase, 'subscriptionState' | 'lineItems'> = {}
  ): SubscriptionPurchase => ({ subscriptionState, startTime, lineItems, ...rest });

  it('reads a paid, renewing subscription as active without a trial', () => {
    expect(mapSubscription(purchase('SUBSCRIPTION_STATE_ACTIVE'), now)).toEqual({
      status: 'ACTIVE',
      autoRenewEnabled: true,
      trialStart: null,
      trialEnd: null,
    });
  });

  it.each([
    ['SUBSCRIPTION_STATE_PENDING', 'PENDING'],
    ['SUBSCRIPTION_STATE_PAUSED', 'PAUSED'],
    ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'IN_GRACE_PERIOD'],
    ['SUBSCRIPTION_STATE_ON_HOLD', 'ON_HOLD'],
    ['SUBSCRIPTION_STATE_EXPIRED', 'EXPIRED'],
    ['SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED', 'PENDING_PURCHASE_CANCELED'],
  ])('maps %s to %s by name', (state, status) => {
    expect(mapSubscription(purchase(state), now)).toMatchObject({ status });
  });

  it('keeps a cancelled subscription active, not renewing, until its period runs out', () => {
    const canceled = purchase('SUBSCRIPTION_STATE_CANCELED', [
      item({ autoRenewingPlan: { autoRenewEnabled: false } }),
    ]);
    expect(mapSubscription(canceled, now)).toEqual({
      status: 'ACTIVE',
      autoRenewEnabled: false,
      trialStart: null,
      trialEnd: null,
    });
  });

  it('is expired once every line item of a cancelled subscription has run out', () => {
    const ranOut = purchase('SUBSCRIPTION_STATE_CANCELED', [
      item({ expiryTime: past, autoRenewingPlan: { autoRenewEnabled: false } }),
    ]);
    expect(mapSubscription(ranOut, now)).toMatchObject({
      status: 'EXPIRED',
      autoRenewEnabled: false,
    });
    // One item still running keeps the subscription active.
    const partly = purchase('SUBSCRIPTION_STATE_CANCELED', [
      item({ expiryTime: past }),
      item({ expiryTime: future }),
    ]);
    expect(mapSubscription(partly, now)).toMatchObject({ status: 'ACTIVE' });
  });

  it('is trialing, with the trial dates, while a line item is in its free-trial phase', () => {
    const trial = purchase('SUBSCRIPTION_STATE_ACTIVE', [item({ offerPhase: { freeTrial: {} } })]);
    expect(mapSubscription(trial, now)).toEqual({
      status: 'TRIALING',
      autoRenewEnabled: true,
      trialStart: startTime,
      trialEnd: future,
    });
  });

  it('stays trialing, not renewing, when the customer cancels during the trial', () => {
    const canceledTrial = purchase('SUBSCRIPTION_STATE_CANCELED', [
      item({ offerPhase: { freeTrial: {} }, autoRenewingPlan: { autoRenewEnabled: false } }),
    ]);
    expect(mapSubscription(canceledTrial, now)).toEqual({
      status: 'TRIALING',
      autoRenewEnabled: false,
      trialStart: startTime,
      trialEnd: future,
    });
  });

  it('carries the trial dates but not the status through a grace period', () => {
    const grace = purchase('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', [
      item({ offerPhase: { freeTrial: {} } }),
    ]);
    expect(mapSubscription(grace, now)).toMatchObject({
      status: 'IN_GRACE_PERIOD',
      trialEnd: future,
    });
  });

  it('is replaced whatever the state says once a replacement cancelled it', () => {
    const replaced = purchase('SUBSCRIPTION_STATE_EXPIRED', [item({ expiryTime: past })], {
      canceledStateContext: { replacementCancellation: {} },
    });
    expect(mapSubscription(replaced, now)).toMatchObject({
      status: 'REPLACED',
      autoRenewEnabled: false,
    });
    const stillRunning = purchase('SUBSCRIPTION_STATE_CANCELED', [item()], {
      canceledStateContext: { replacementCancellation: {} },
    });
    expect(mapSubscription(stillRunning, now)).toMatchObject({ status: 'REPLACED' });
  });

  it('renews into the new plan of a deferred replacement, whose items carry no flag', () => {
    const deferred = purchase('SUBSCRIPTION_STATE_ACTIVE', [
      { autoRenewingPlan: {}, offerPhase: {} },
      item({ autoRenewingPlan: {}, offerPhase: { prorationPeriod: {} } }),
    ]);
    expect(mapSubscription(deferred, now)).toMatchObject({ autoRenewEnabled: true });
    // Unless Play says the subscription is cancelled.
    expect(
      mapSubscription({ ...deferred, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, now)
    ).toMatchObject({ status: 'ACTIVE', autoRenewEnabled: false });
  });

  it('does not renew a prepaid plan, or a subscription whose items turned renewal off', () => {
    const prepaid = purchase('SUBSCRIPTION_STATE_ACTIVE', [
      { expiryTime: future, autoRenewingPlan: null },
    ]);
    expect(mapSubscription(prepaid, now)).toMatchObject({ autoRenewEnabled: false });
    const off = purchase('SUBSCRIPTION_STATE_ACTIVE', [
      item({ autoRenewingPlan: { autoRenewEnabled: false } }),
    ]);
    expect(mapSubscription(off, now)).toMatchObject({ autoRenewEnabled: false });
  });

  it('has no trial start while the subscription is pending', () => {
    const pending = purchase('SUBSCRIPTION_STATE_PENDING', [
      item({ offerPhase: { freeTrial: {} } }),
    ]);
    expect(mapSubscription({ ...pending, startTime: null }, now)).toMatchObject({
      status: 'PENDING',
      trialStart: null,
      trialEnd: future,
    });
  });

  it('throws for an unmapped or missing state', () => {
    expect(() => mapSubscription(purchase('SUBSCRIPTION_STATE_UNSPECIFIED'), now)).toThrow(
      'Unknown Google Play subscription state: SUBSCRIPTION_STATE_UNSPECIFIED'
    );
    expect(() => mapSubscription({ lineItems: [item()] }, now)).toThrow(
      'Unknown Google Play subscription state: undefined'
    );
  });
});

describe('mapCancellationDetails', () => {
  it('maps the cancel survey of a user cancellation', () => {
    expect(
      mapCancellationDetails({
        userInitiatedCancellation: {
          cancelTime: '2026-09-12T14:44:08.552Z',
          cancelSurveyResult: {
            reason: 'CANCEL_SURVEY_REASON_OTHERS',
            reasonUserInput: 'Moving to the web app',
          },
        },
      })
    ).toEqual({
      initiator: 'user',
      reason: 'CANCEL_SURVEY_REASON_OTHERS',
      feedback: 'other',
      comment: 'Moving to the web app',
    });
    expect(
      mapCancellationDetails({
        userInitiatedCancellation: {
          cancelSurveyResult: { reason: 'CANCEL_SURVEY_REASON_COST_RELATED' },
        },
      })
    ).toMatchObject({ initiator: 'user', feedback: 'too_expensive', comment: null });
  });

  it('reports an unanswered survey as a user cancellation without feedback', () => {
    expect(mapCancellationDetails({ userInitiatedCancellation: {} })).toEqual({
      initiator: 'user',
      reason: null,
      feedback: null,
      comment: null,
    });
  });

  it('tells system and developer cancellations apart', () => {
    expect(mapCancellationDetails({ systemInitiatedCancellation: {} })).toMatchObject({
      initiator: 'system',
    });
    expect(mapCancellationDetails({ developerInitiatedCancellation: {} })).toMatchObject({
      initiator: 'developer',
    });
  });

  it('is null while the subscription renews and for a replacement', () => {
    expect(mapCancellationDetails(undefined)).toBeNull();
    expect(mapCancellationDetails({ replacementCancellation: {} })).toBeNull();
  });
});

describe('mapCanceledAt', () => {
  it('reads the time of a user cancellation and nothing else', () => {
    expect(
      mapCanceledAt({ userInitiatedCancellation: { cancelTime: '2026-09-12T14:44:08.552Z' } })
    ).toBe('2026-09-12T14:44:08.552Z');
    expect(mapCanceledAt({ systemInitiatedCancellation: {} })).toBeNull();
    expect(mapCanceledAt(null)).toBeNull();
  });
});

describe('mapPaymentType', () => {
  it('reads the base order id as the start and a suffixed one as a renewal', () => {
    expect(mapPaymentType('GPA.3345-1234-5678-90123')).toBe('SUBSCRIPTION_START');
    expect(mapPaymentType('GPA.3345-1234-5678-90123..0')).toBe('SUBSCRIPTION_RENEWAL');
    expect(mapPaymentType('GPA.3345-1234-5678-90123..12')).toBe('SUBSCRIPTION_RENEWAL');
  });
});

describe('mapGraceUntil', () => {
  it('is the extended expiry time while the subscription is in grace', () => {
    expect(mapGraceUntil('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', '2026-11-20T08:00:00.123Z')).toBe(
      '2026-11-20T08:00:00.123Z'
    );
  });

  it('is null on hold, while active, or without an expiry time', () => {
    expect(mapGraceUntil('SUBSCRIPTION_STATE_ON_HOLD', '2026-11-20T08:00:00Z')).toBeNull();
    expect(mapGraceUntil('SUBSCRIPTION_STATE_ACTIVE', '2026-11-20T08:00:00Z')).toBeNull();
    expect(mapGraceUntil('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', null)).toBeNull();
  });
});
