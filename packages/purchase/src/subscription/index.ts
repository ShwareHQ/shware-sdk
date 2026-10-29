export const PLATFORMS = ['APPLE', 'GOOGLE', 'STRIPE'] as const;

export type Platform = (typeof PLATFORMS)[number];

/**
 * What a payment was for, on every platform.
 *
 * - ONE_TIME: a one-time purchase.
 * - SUBSCRIPTION_START: the first paid charge of a subscription.
 * - SUBSCRIPTION_RENEWAL: a charge for a new billing period on the regular cycle.
 * - SUBSCRIPTION_UPDATE: a charge mid-period, outside the cycle: the proration of a plan change, or
 *   a manual invoice on the subscription. Kept apart from renewals so renewal rates stay honest.
 */
export const PAYMENT_TYPES = [
  'ONE_TIME',
  'SUBSCRIPTION_START',
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_UPDATE',
] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

/**
 * Where a refund stands, on every platform. Stripe reports all of them; Apple and Google report a
 * refund once it is done (SUCCEEDED), and Apple can take it back (REVERSED, `REFUND_REVERSED`).
 */
export const REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REVERSED'] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * Where a refund may move from the status it has. Notifications arrive out of order and are
 * redelivered, so a status only ever moves forward along these edges:
 * - PENDING settles into anything (Stripe: succeeded / failed / canceled).
 * - SUCCEEDED can still become FAILED (Stripe: the money could not be returned after all) or
 *   REVERSED (Apple: REFUND_REVERSED).
 * - FAILED, CANCELED and REVERSED are final: nothing a platform sends afterwards reopens them.
 * Nothing moves back to PENDING, and a status never "moves" to itself (a redelivery is a no-op).
 */
export const REFUND_STATUS_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  PENDING: ['SUCCEEDED', 'FAILED', 'CANCELED', 'REVERSED'],
  SUCCEEDED: ['FAILED', 'REVERSED'],
  FAILED: [],
  CANCELED: [],
  REVERSED: [],
};

/**
 * Stripe's dispute statuses, as they are: the `warning_*` ones are inquiries and early fraud
 * warnings that may never become a chargeback, `prevented` is one Stripe blocked before it was
 * filed. Only LOST costs money. Stripe only: Apple and Google absorb chargebacks themselves and
 * report them as refunds.
 */
export const DISPUTE_STATUSES = [
  'WARNING_NEEDS_RESPONSE',
  'WARNING_UNDER_REVIEW',
  'WARNING_CLOSED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'PREVENTED',
  'WON',
  'LOST',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** A dispute in one of these is over; nothing Stripe sends afterwards reopens it. */
export const CLOSED_DISPUTE_STATUSES: readonly DisputeStatus[] = [
  'WON',
  'LOST',
  'WARNING_CLOSED',
  'PREVENTED',
];

/**
 * [Stripe Subscription Status](https://stripe.com/docs/api/subscriptions/object#subscription_object-status)
 * [Stripe Subscription Lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
 *
 * provision product for customer when Status = TRIALING, ACTIVE, IN_GRACE_PERIOD, PAST_DUE
 * (see `AVAILABLE_STATUSES`)
 */
export const SUBSCRIPTION_STATUSES = [
  /**
   * The subscription is currently in a trial period and it’s safe to provision your product for
   * your customer. The subscription transitions automatically to active when the first payment
   * is made.
   *
   * Google: play(LineItems[0].OfferDetails.OfferId == 'xx')
   *
   * Platform: Apple, Google, Stripe
   * */
  'TRIALING',

  /**
   * The subscription is in good standing and the most recent payment is successful. It’s safe to
   * provision your product for your customer.
   *
   * Platform: Apple, Google, Stripe
   * */
  'ACTIVE',

  /**
   * Apple: The subscription enters the billing retry period. If the subtype is GRACE_PERIOD,
   * continue to provide service through the grace period. If the subtype is empty, the
   * subscription isn’t in a grace period and you can stop providing the subscription service.
   *
   * Google: Subscription is in grace period. The state is only available when the subscription
   * is an auto renewing plan. In this state, all items are in grace period.
   *
   * Platform: Apple, Google
   * */
  'IN_GRACE_PERIOD',

  /**
   * A successful payment needs to be made within 23 hours to activate the subscription. Or the
   * payment requires action, like customer authentication. Subscriptions can also be incomplete
   * if there’s a pending payment and the PaymentIntent status would be processing.
   *
   * Platform: Stripe
   * */
  'INCOMPLETE',

  /**
   * The initial payment on the subscription failed and no successful payment was made within 23
   * hours of creating the subscription. These subscriptions don’t bill customers. This status
   * exists so you can track customers that failed to activate their subscriptions.
   *
   * Platform: Stripe
   * */
  'INCOMPLETE_EXPIRED',

  /**
   * Subscription was created but awaiting payment during signup. In this state, all items are
   * awaiting payment.
   *
   * Platform: Google
   * */
  'PENDING',

  /**
   * Pending transaction for subscription is canceled. If this pending purchase was for an
   * existing subscription, use linkedPurchaseToken to get the current state of that subscription.
   *
   * Platform: Google
   * */
  'PENDING_PURCHASE_CANCELED',

  /**
   * Payment on the latest finalized invoice either failed or wasn’t attempted. The subscription
   * continues to create invoices. Your subscription settings determine the subscription’s next
   * state. If the invoice is still unpaid after all Smart Retries have been attempted, you can
   * configure the subscription to move to canceled, unpaid, or leave it as past_due. To move the
   * subscription to active, pay the most recent invoice before its due date.
   *
   * This is Stripe's grace period: the customer keeps the product while Stripe retries (Smart
   * Retries, up to about three weeks), as an App Store or Play customer does in IN_GRACE_PERIOD,
   * so it is in `AVAILABLE_STATUSES`; access ends at UNPAID or CANCELED.
   *
   * Platform: Stripe
   * */
  'PAST_DUE',

  /**
   * Apple: the billing retry period of a subscription without a grace period (App Store Server API
   * status 3). Apple keeps retrying the charge for up to 60 days; the subscription is not over, but
   * Apple does not consider it active and the customer is not served meanwhile. A billing retry
   * with a grace period is IN_GRACE_PERIOD.
   *
   * Platform: Apple
   * */
  'BILLING_RETRY',

  /**
   * Subscription is on hold (suspended). The state is only available when the subscription is an
   * auto renewing plan. In this state, all items are on hold. Grace period ends or Active period
   * ends but not grace period
   *
   * Platform: Google
   * */
  'ON_HOLD',

  /**
   * The subscription has been canceled. What that covers differs per platform, so do not compare
   * CANCELED counts across platforms without accounting for it:
   *
   * - Stripe: `canceled`, whether ended immediately or at the natural end of the period after
   *   `cancel_at_period_end`. Stripe has no separate expired state, so a subscription that ran out
   *   after the customer cancelled is CANCELED here. During cancellation, automatic collection for
   *   all unpaid invoices is disabled (auto_advance=false). This is a terminal state that can’t be
   *   updated.
   * - Apple: `REVOKED` only (refunded, or revoked from Family Sharing). A subscription that runs out
   *   at the end of its period is EXPIRED, not CANCELED.
   * - Google: `SUBSCRIPTION_STATE_CANCELED`, the customer turned off auto-renew but the current
   *   period has not ended yet; it is not terminal. Consumers keep the product available until the
   *   expiry time, after which Google reports EXPIRED.
   *
   * Platform: Apple, Google, Stripe
   * */
  'CANCELED',

  /**
   * The latest invoice hasn’t been paid but the subscription remains in place. The latest invoice
   * remains open and invoices continue to be generated but payments aren’t attempted. You should
   * revoke access to your product when the subscription is unpaid since payments were already
   * attempted and retried when it was past_due. To move the subscription to active, pay the most
   * recent invoice before its due date.
   *
   * Platform: Stripe
   * */
  'UNPAID',

  /**
   * Google: Subscription is paused. The state is only available when the subscription is an auto
   * renewing plan. In this state, all items are in paused state.
   *
   * Stripe: The subscription has ended its trial period without a default payment method and the
   * trial_settings.end_behavior.missing_payment_method is set to pause. Invoices will no longer
   * be created for the subscription. After a default payment method has been attached to the
   * customer, you can resume the subscription.
   *
   * Platform: Google, Stripe
   * */
  'PAUSED',

  /**
   * For example, a user buys a subscription and receives a purchase token A. The
   * linkedPurchaseToken field will not be set in the API response because the purchase token
   * belongs to a brand new subscription.
   *
   * If the user upgrades their subscription, a new purchase token B will be generated. Since the
   * upgrade is replacing the subscription from purchase token A, the linkedPurchaseToken field
   * for token B will be set to point to token A. Notice it points backwards in time to the
   * original purchase token.
   *
   * +---------------------------+  +------------------------+  +------------------------+
   * | Step 1 first purchase     |  | Step 2 upgrades        |  | Step 3 downgrades      |
   * | purchaseToken: A          |->| purchaseToken: B       |->| purchaseToken: C       |
   * | linkedPurchaseToken: null |  | linkedPurchaseToken: A |  | linkedPurchaseToken: B |
   * +---------------------------+  +------------------------+  +------------------------+
   *
   * Platform: Google
   * */
  'REPLACED',

  /**
   * The subscription ran out at the end of its period without renewing.
   *
   * - Apple: the natural end of a subscription, including one the customer cancelled (auto-renew
   *   off), a billing retry that gave up, or a declined price increase.
   * - Google: `SUBSCRIPTION_STATE_EXPIRED`, all items have expiryTime in the past; a cancelled
   *   subscription reaches it once its period ends.
   * - Stripe never reports EXPIRED: a subscription ending after `cancel_at_period_end` is CANCELED.
   *
   * Platform: Apple, Google
   * */
  'EXPIRED',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Statuses where it is safe to provision your product for the customer. A failing renewal keeps
 * the product while the store retries and means the customer to be served (IN_GRACE_PERIOD on the
 * App Store and Play, PAST_DUE on Stripe during Smart Retries); it loses it once the store has
 * given up (UNPAID or CANCELED on Stripe) or retries without serving the customer (BILLING_RETRY on
 * the App Store, ON_HOLD on Play).
 */
export const AVAILABLE_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'IN_GRACE_PERIOD',
  'PAST_DUE',
] as const satisfies readonly SubscriptionStatus[];

/** Who stopped the subscription from renewing. */
export const CANCELLATION_INITIATORS = [
  /** The customer: the store's cancel flow, our own cancel dialog, or a declined price increase. */
  'user',
  /** The platform: a failed payment, a refund or revocation, a product no longer for sale. */
  'system',
  /** Us: a cancellation through the platform's API or console. */
  'developer',
] as const;

export type CancellationInitiator = (typeof CANCELLATION_INITIATORS)[number];

/** What a cancel survey may report, whichever platform asked the question. */
export const CANCELLATION_FEEDBACKS = [
  'customer_service',
  'low_quality',
  'missing_features',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
  'other',
] as const;

export type CancellationFeedback = (typeof CANCELLATION_FEEDBACKS)[number];

export const RESUBSCRIBE_INTENTS = ['maybe', 'no', 'yes'] as const;

export type ResubscribeIntent = (typeof RESUBSCRIBE_INTENTS)[number];

/**
 * Why a subscription stopped renewing, in one record shared by every platform. Every key is
 * optional and every value a string, so a platform may add what only it reports without a
 * schema change; the keys below are the ones they have in common. When the subscription was
 * cancelled is not in here: it is a column of its own, `canceledAt`.
 *
 * - `initiator`: see {@link CANCELLATION_INITIATORS}.
 * - `reason`: the platform's own code, kept verbatim for analytics — Stripe's
 *   `cancellation_details.reason`, Google's `cancelSurveyResult.reason`, Apple's notification
 *   subtype or `expirationIntent`.
 * - `feedback`: the customer's survey answer in the shared vocabulary {@link CANCELLATION_FEEDBACKS}.
 * - `comment`: free text the customer typed.
 * - `resubscribeIntent`: whether they said they would come back, when the cancel flow asked.
 */
export interface CancellationDetails {
  [key: string]: string | null | undefined;
  initiator?: CancellationInitiator | null;
  reason?: string | null;
  feedback?: CancellationFeedback | null;
  comment?: string | null;
  resubscribeIntent?: ResubscribeIntent | null;
}
