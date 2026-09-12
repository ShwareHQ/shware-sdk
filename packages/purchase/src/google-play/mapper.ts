import type { CancellationDetails, SubscriptionStatus } from '../subscription/index';
import type { GooglePlaySubscriptionState } from './real-time-developer-notification';

export function mapSubscriptionStatus(state: GooglePlaySubscriptionState): SubscriptionStatus {
  switch (state) {
    case 'SUBSCRIPTION_STATE_PENDING':
      return 'PENDING';
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'ACTIVE';
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'PAUSED';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'IN_GRACE_PERIOD';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'ON_HOLD';
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'CANCELED';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'PENDING_PURCHASE_CANCELED';
    default:
      throw new Error(`Unknown Google Play subscription state: ${state}`);
  }
}

/** Play's cancel-survey answers in the shared vocabulary. */
const SURVEY_FEEDBACK: Record<string, CancellationDetails['feedback']> = {
  CANCEL_SURVEY_REASON_NOT_ENOUGH_USAGE: 'unused',
  CANCEL_SURVEY_REASON_TECHNICAL_ISSUES: 'low_quality',
  CANCEL_SURVEY_REASON_COST_RELATED: 'too_expensive',
  CANCEL_SURVEY_REASON_FOUND_BETTER_APP: 'switched_service',
  CANCEL_SURVEY_REASON_OTHERS: 'other',
};

/**
 * `canceledStateContext` of `purchases.subscriptionsv2.get`, declared structurally so this
 * module does not depend on the Play Developer API client.
 */
export interface CanceledStateContext {
  userInitiatedCancellation?: {
    cancelTime?: string | null;
    cancelSurveyResult?: { reason?: string | null; reasonUserInput?: string | null } | null;
  } | null;
  systemInitiatedCancellation?: object | null;
  developerInitiatedCancellation?: object | null;
  replacementCancellation?: object | null;
}

/**
 * Why a Play subscription stopped renewing. The Play Store asks the user for a reason on cancel
 * (and for free text when it is "Other"), which comes back in `cancelSurveyResult`. Null while
 * the subscription renews, and for a replacement: that is the linked purchase taking over, not a
 * cancellation to report.
 */
export function mapCancellationDetails(
  context: CanceledStateContext | null | undefined
): CancellationDetails | null {
  if (!context) return null;
  if (context.userInitiatedCancellation) {
    const survey = context.userInitiatedCancellation.cancelSurveyResult;
    return {
      initiator: 'user',
      reason: survey?.reason ?? null,
      feedback: (survey?.reason && SURVEY_FEEDBACK[survey.reason]) || null,
      comment: survey?.reasonUserInput ?? null,
    };
  }
  if (context.systemInitiatedCancellation) {
    return { initiator: 'system', reason: 'SYSTEM_INITIATED', feedback: null, comment: null };
  }
  if (context.developerInitiatedCancellation) {
    return { initiator: 'developer', reason: 'DEVELOPER_INITIATED', feedback: null, comment: null };
  }
  return null;
}

/**
 * When the subscription was cancelled. Only a user cancellation carries the time; for the others
 * the caller falls back to when it learnt of it.
 */
export function mapCanceledAt(context: CanceledStateContext | null | undefined): string | null {
  return context?.userInitiatedCancellation?.cancelTime ?? null;
}
