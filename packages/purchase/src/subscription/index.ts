export enum Platform {
  APPLE = 'APPLE',
  GOOGLE = 'GOOGLE',
  STRIPE = 'STRIPE',
}

export const ALL_PLATFORMS = [Platform.APPLE, Platform.GOOGLE, Platform.STRIPE] as const;

/**
 * [Stripe Subscription Status](https://stripe.com/docs/api/subscriptions/object#subscription_object-status)
 * [Stripe Subscription Lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
 *
 * provision product for customer when Status = TRIALING, ACTIVE, IN_GRACE_PERIOD
 */
export enum SubscriptionStatus {
  /**
   * The subscription is currently in a trial period and it’s safe to provision your product for
   * your customer. The subscription transitions automatically to active when the first payment
   * is made.
   *
   * Google: play(LineItems[0].OfferDetails.OfferId == 'xx')
   *
   * Platform: Apple, Google, Stripe
   * */
  TRIALING = 'TRIALING',

  /**
   * The subscription is in good standing and the most recent payment is successful. It’s safe to
   * provision your product for your customer.
   *
   * Platform: Apple, Google, Stripe
   * */
  ACTIVE = 'ACTIVE',

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
  IN_GRACE_PERIOD = 'IN_GRACE_PERIOD',

  /**
   * A successful payment needs to be made within 23 hours to activate the subscription. Or the
   * payment requires action, like customer authentication. Subscriptions can also be incomplete
   * if there’s a pending payment and the PaymentIntent status would be processing.
   *
   * Platform: Stripe
   * */
  INCOMPLETE = 'INCOMPLETE',

  /**
   * The initial payment on the subscription failed and no successful payment was made within 23
   * hours of creating the subscription. These subscriptions don’t bill customers. This status
   * exists so you can track customers that failed to activate their subscriptions.
   *
   * Platform: Stripe
   * */
  INCOMPLETE_EXPIRED = 'INCOMPLETE_EXPIRED',

  /**
   * Subscription was created but awaiting payment during signup. In this state, all items are
   * awaiting payment.
   *
   * Platform: Google
   * */
  PENDING = 'PENDING',

  /**
   * Pending transaction for subscription is canceled. If this pending purchase was for an
   * existing subscription, use linkedPurchaseToken to get the current state of that subscription.
   *
   * Platform: Google
   * */
  PENDING_PURCHASE_CANCELED = 'PENDING_PURCHASE_CANCELED',

  /**
   * Payment on the latest finalized invoice either failed or wasn’t attempted. The subscription
   * continues to create invoices. Your subscription settings determine the subscription’s next
   * state. If the invoice is still unpaid after all Smart Retries have been attempted, you can
   * configure the subscription to move to canceled, unpaid, or leave it as past_due. To move the
   * subscription to active, pay the most recent invoice before its due date.
   *
   * Platform: Stripe
   * */
  PAST_DUE = 'PAST_DUE',

  /**
   * Subscription is on hold (suspended). The state is only available when the subscription is an
   * auto renewing plan. In this state, all items are on hold. Grace period ends or Active period
   * ends but not grace period
   *
   * Platform: Google
   * */
  ON_HOLD = 'ON_HOLD',

  /**
   * The subscription has been canceled. During cancellation, automatic collection for all unpaid
   * invoices is disabled (auto_advance=false). This is a terminal state that can’t be updated.
   *
   * Platform: Apple, Google, Stripe
   * */
  CANCELED = 'CANCELED',

  /**
   * The latest invoice hasn’t been paid but the subscription remains in place. The latest invoice
   * remains open and invoices continue to be generated but payments aren’t attempted. You should
   * revoke access to your product when the subscription is unpaid since payments were already
   * attempted and retried when it was past_due. To move the subscription to active, pay the most
   * recent invoice before its due date.
   *
   * Platform: Stripe
   * */
  UNPAID = 'UNPAID',

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
  PAUSED = 'PAUSED',

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
  REPLACED = 'REPLACED',

  /**
   * Google: 	Subscription is expired. All items have expiryTime in the past.
   *
   * Platform: Apple, Google
   * */
  EXPIRED = 'EXPIRED',
}

export const AVAILABLE_STATUS = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.IN_GRACE_PERIOD,
] as const;

export const ALL_SUBSCRIPTION_STATUS = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.IN_GRACE_PERIOD,
  SubscriptionStatus.INCOMPLETE,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
  SubscriptionStatus.PENDING,
  SubscriptionStatus.PENDING_PURCHASE_CANCELED,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.ON_HOLD,
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.UNPAID,
  SubscriptionStatus.PAUSED,
  SubscriptionStatus.REPLACED,
  SubscriptionStatus.EXPIRED,
] as const;
