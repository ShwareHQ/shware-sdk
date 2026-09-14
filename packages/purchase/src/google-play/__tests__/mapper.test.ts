import { describe, expect, it } from 'vitest';
import { mapCanceledAt, mapCancellationDetails, mapSubscriptionStatus } from '../mapper';

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
