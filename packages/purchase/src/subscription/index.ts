export const PLATFORMS = ['APPLE', 'GOOGLE', 'STRIPE'] as const;

export type Platform = (typeof PLATFORMS)[number];

/**
 * [Stripe Subscription Status](https://stripe.com/docs/api/subscriptions/object#subscription_object-status)
 * [Stripe Subscription Lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
 *
 * provision product for customer when Status = TRIALING, ACTIVE, IN_GRACE_PERIOD
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
   * Platform: Stripe
   * */
  'PAST_DUE',

  /**
   * Subscription is on hold (suspended). The state is only available when the subscription is an
   * auto renewing plan. In this state, all items are on hold. Grace period ends or Active period
   * ends but not grace period
   *
   * Platform: Google
   * */
  'ON_HOLD',

  /**
   * The subscription has been canceled. During cancellation, automatic collection for all unpaid
   * invoices is disabled (auto_advance=false). This is a terminal state that can’t be updated.
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
   * Google: Subscription is expired. All items have expiryTime in the past.
   *
   * Platform: Apple, Google
   * */
  'EXPIRED',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** statuses where it is safe to provision your product for the customer */
export const AVAILABLE_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'IN_GRACE_PERIOD',
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
