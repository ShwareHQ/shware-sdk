import type {
  CancellationDetails,
  PaymentType,
  SubscriptionState,
  SubscriptionStatus,
} from '../subscription/index';
import {
  GOOGLE_PLAY_SUBSCRIPTION_STATES,
  type GooglePlaySubscriptionState,
} from './real-time-developer-notification';

/**
 * The `lineItems[]` fields of `purchases.subscriptionsv2.get` that {@link mapSubscription} reads,
 * declared structurally so this module does not depend on the Play Developer API client.
 */
export interface SubscriptionLineItem {
  /** When the item's entitlement ends; unset for a deferred replacement's unbilled item. */
  expiryTime?: string | null;
  /** Set for an auto-renewing plan; `autoRenewEnabled` is unset on a deferred replacement's items. */
  autoRenewingPlan?: { autoRenewEnabled?: boolean | null } | null;
  /** The offer phase the item is in right now; `freeTrial` is set during a free trial. */
  offerPhase?: {
    basePrice?: object | null;
    freeTrial?: object | null;
    introductoryPrice?: object | null;
    prorationPeriod?: object | null;
  } | null;
}

/** The fields of `purchases.subscriptionsv2.get` that {@link mapSubscription} reads. */
export interface SubscriptionPurchase {
  subscriptionState?: string | null;
  /** When the subscription was granted; unset while it is pending. */
  startTime?: string | null;
  lineItems?: SubscriptionLineItem[] | null;
  canceledStateContext?: CanceledStateContext | null;
}

/**
 * A Play subscription purchase in the shape a subscription row stores, see {@link SubscriptionState}.
 * Play's states are the unified ones by name, with these readings:
 *
 * - `SUBSCRIPTION_STATE_CANCELED` is not CANCELED. Play uses it for a subscription whose auto-renew
 *   is off while the paid period still runs ("canceled but not expired yet"), which Stripe reports
 *   as `cancel_at_period_end` and Apple as `autoRenewStatus` off, both ACTIVE: so it is ACTIVE (or
 *   TRIALING) with `autoRenewEnabled: false`, and the cancellation itself is in `canceledStateContext`
 *   ({@link mapCancellationDetails}, {@link mapCanceledAt}). Once every line item's `expiryTime`
 *   has passed it is EXPIRED, whether or not Play's `SUBSCRIPTION_EXPIRED` has arrived yet.
 * - `canceledStateContext.replacementCancellation` is REPLACED whatever the state says: the linked
 *   purchase that replaced it is the one the customer has now.
 * - A line item in its free-trial offer phase (`offerPhase.freeTrial`, the phase the item is in right
 *   now) makes an active subscription TRIALING, with `trialStart` the subscription's `startTime`
 *   (a trial is always an offer's first phase) and `trialEnd` the item's `expiryTime`, the first
 *   charge. The offer id and the order's amount are not used: an introductory price names an offer
 *   too, and a deferred replacement's order is $0 as well.
 * - `autoRenewEnabled` is whether any line item still renews. Neither item of a deferred replacement
 *   (the old plan carried to the end of its period, the new one not yet billed) carries the flag,
 *   but the subscription as a whole renews into the new plan, so it is on unless Play reports the
 *   subscription cancelled; a prepaid plan renews nothing. Off once the subscription is over.
 *
 * `now` is only for tests and replays; it decides whether a cancelled subscription has run out.
 *
 * ref: [SubscriptionPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2#SubscriptionPurchaseV2)
 */
export function mapSubscription(
  purchase: SubscriptionPurchase,
  now: number = Date.now()
): SubscriptionState {
  const state = subscriptionStateOf(purchase);
  const lineItems = purchase.lineItems ?? [];
  const trial = lineItems.find((item) => item.offerPhase?.freeTrial);

  let status: SubscriptionStatus;
  if (purchase.canceledStateContext?.replacementCancellation) {
    status = 'REPLACED';
  } else if (state === 'SUBSCRIPTION_STATE_CANCELED') {
    const expired =
      lineItems.length > 0 &&
      lineItems.every(
        (item) => typeof item.expiryTime === 'string' && Date.parse(item.expiryTime) <= now
      );
    status = expired ? 'EXPIRED' : 'ACTIVE';
  } else {
    status = mapSubscriptionStatus(state);
  }
  if (status === 'ACTIVE' && trial) status = 'TRIALING';

  return {
    status,
    autoRenewEnabled: isAutoRenewing(state, lineItems),
    trialStart: trial && purchase.startTime ? new Date(purchase.startTime).toISOString() : null,
    trialEnd: trial?.expiryTime ? new Date(trial.expiryTime).toISOString() : null,
  };
}

function subscriptionStateOf(purchase: SubscriptionPurchase): GooglePlaySubscriptionState {
  const state = purchase.subscriptionState;
  const known = GOOGLE_PLAY_SUBSCRIPTION_STATES.find((item) => item === state);
  if (!known) throw new Error(`Unknown Google Play subscription state: ${state}`);
  return known;
}

/** Play's states other than CANCELED, which {@link mapSubscription} reads with the line items. */
function mapSubscriptionStatus(
  state: Exclude<GooglePlaySubscriptionState, 'SUBSCRIPTION_STATE_CANCELED'>
): SubscriptionStatus {
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
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'PENDING_PURCHASE_CANCELED';
    default:
      throw new Error(`Unknown Google Play subscription state: ${state}`);
  }
}

function isAutoRenewing(state: GooglePlaySubscriptionState, lineItems: SubscriptionLineItem[]) {
  if (
    state === 'SUBSCRIPTION_STATE_CANCELED' ||
    state === 'SUBSCRIPTION_STATE_EXPIRED' ||
    state === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
  ) {
    return false;
  }
  const flags = lineItems.flatMap((item) => {
    const flag = item.autoRenewingPlan?.autoRenewEnabled;
    return typeof flag === 'boolean' ? [flag] : [];
  });
  if (flags.length > 0) return flags.some(Boolean);
  return lineItems.some((item) => Boolean(item.autoRenewingPlan));
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
 * What a paid Play subscription order was for, by its order id. Play numbers a subscription's
 * orders from the first purchase: the initial order is `GPA.1234-5678-9012-34567`, each renewal
 * the same id with `..0`, `..1`, ... appended. A plan change through the Play Store is a new
 * purchase with an order id of its own, so it reads as a start, like any first purchase.
 *
 * ref: [Order ID](https://developer.android.com/google/play/billing/subscriptions#renewals)
 */
export function mapPaymentType(orderId: string): Exclude<PaymentType, 'ONE_TIME'> {
  return orderId.includes('..') ? 'SUBSCRIPTION_RENEWAL' : 'SUBSCRIPTION_START';
}

/**
 * When the subscription was cancelled. Only a user cancellation carries the time; for the others
 * the caller falls back to when it learnt of it.
 */
export function mapCanceledAt(context: CanceledStateContext | null | undefined): string | null {
  return context?.userInitiatedCancellation?.cancelTime ?? null;
}

/**
 * When a Play grace period ends, as an ISO timestamp: the date by which the customer has to fix
 * their payment method before the subscription goes on account hold. During
 * `SUBSCRIPTION_STATE_IN_GRACE_PERIOD` Play extends the line item's `expiryTime` to the end of the
 * grace period, so that is the date. Null in any other state (on hold, the customer has already
 * lost access) and when no expiry time was sent.
 *
 * ref: [Grace period](https://developer.android.com/google/play/billing/lifecycle/subscriptions#grace-period)
 */
export function mapGraceUntil(
  state: GooglePlaySubscriptionState,
  expiryTime: string | null | undefined
): string | null {
  if (state !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' || !expiryTime) return null;
  return new Date(expiryTime).toISOString();
}
