// ref: https://cloud.google.com/pubsub/docs/reference/rest/v1/PubsubMessage
export type PubsubMessage = {
  data: string;
  attributes: Record<string, string>;
  messageId: string;
  publishTime: string;
  orderingKey: string;
};

/** https://developer.android.com/google/play/billing/rtdn-reference */
export interface DeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: number;
  subscriptionNotification: SubscriptionNotification;
  oneTimeProductNotification: OneTimeProductNotification;
  voidedPurchaseNotification: VoidedPurchaseNotification;
  testNotification: TestNotification;
}

/**
 * [Real-time developer notifications reference guide](https://developer.android.com/google/play/billing/rtdn-reference)
 * */
export enum SubscriptionNotificationType {
  /** A subscription was recovered from account hold. */
  SUBSCRIPTION_RECOVERED = 1,

  /** An active subscription was renewed. */
  SUBSCRIPTION_RENEWED = 2,

  /**
   * A subscription was either voluntarily or involuntarily cancelled. For voluntary cancellation,
   * sent when the user cancels.
   */
  SUBSCRIPTION_CANCELED = 3,

  /** A new subscription was purchased. */
  SUBSCRIPTION_PURCHASED = 4,

  /** A subscription has entered account hold (if enabled). */
  SUBSCRIPTION_ON_HOLD = 5,

  /** A subscription has entered grace period (if enabled). */
  SUBSCRIPTION_IN_GRACE_PERIOD = 6,

  /**
   * User has restored their subscription from Play > Account > Subscriptions. The subscription was
   * canceled but had not expired yet when the user restores. For more information, see Restorations.
   */
  SUBSCRIPTION_RESTARTED = 7,

  /** (DEPRECATED) A subscription price change has successfully been confirmed by the user. */
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED = 8,

  /** A subscription's recurrence time has been extended. */
  SUBSCRIPTION_DEFERRED = 9,

  /** A subscription has been paused. */
  SUBSCRIPTION_PAUSED = 10,

  /** A subscription pause schedule has been changed. */
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED = 11,

  /** A subscription has been revoked from the user before the expiration time. */
  SUBSCRIPTION_REVOKED = 12,

  /** A subscription has expired. */
  SUBSCRIPTION_EXPIRED = 13,

  /** A subscription item's price change details are updated. */
  SUBSCRIPTION_PRICE_CHANGE_UPDATED = 19,

  /** A pending transaction of a subscription has been canceled. */
  SUBSCRIPTION_PENDING_PURCHASE_CANCELED = 20,
}

export interface SubscriptionNotification {
  version: string;
  purchaseToken: string;
  notificationType: SubscriptionNotificationType;
}

export enum OneTimeProductNotificationType {
  /** A one-time product was successfully purchased by a user. */
  ONE_TIME_PRODUCT_PURCHASED = 1,

  /** A pending one-time product purchase has been canceled by the user. */
  ONE_TIME_PRODUCT_CANCELED = 2,
}

export interface OneTimeProductNotification {
  version: string;
  sku: string;
  purchaseToken: string;
  notificationType: OneTimeProductNotificationType;
}

export enum VoidedPurchaseProductType {
  /** A subscription purchase has been voided. */
  PRODUCT_TYPE_SUBSCRIPTION = 1,

  /** A one-time purchase has been voided. */
  PRODUCT_TYPE_ONE_TIME = 2,
}

/**
 * Note when the remaining total quantity of a multi-quantity purchase is refunded, the refundType
 * will be REFUND_TYPE_FULL_REFUND.
 */
export enum VoidedPurchaseRefundType {
  /** The purchase has been fully voided. */
  REFUND_TYPE_FULL_REFUND = 1,

  /**
   * The purchase has been partially voided by a quantity-based partial refund, applicable only to
   * multi-quantity purchases. A purchase can be partially voided multiple times.
   */
  REFUND_TYPE_QUANTITY_BASED_PARTIAL_REFUND = 2,
}

export interface VoidedPurchaseNotification {
  purchaseToken: string;
  orderId: string;
  productType: VoidedPurchaseProductType;
  refundType: VoidedPurchaseRefundType;
}

export interface TestNotification {
  version: string;
}

/** ref: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2#SubscriptionState */
export enum GooglePlaySubscriptionState {
  /** Unspecified subscription state. */
  SUBSCRIPTION_STATE_UNSPECIFIED = 'SUBSCRIPTION_STATE_UNSPECIFIED',

  /**
   * Subscription was created but awaiting payment during signup. In this state, all items are
   * awaiting payment.
   */
  SUBSCRIPTION_STATE_PENDING = 'SUBSCRIPTION_STATE_PENDING',

  /**
   * Subscription is active.
   * (1) If the subscription is an auto renewing plan, at least one item is autoRenewEnabled and not expired.
   * (2) If the subscription is a prepaid plan, at least one item is not expired.
   */
  SUBSCRIPTION_STATE_ACTIVE = 'SUBSCRIPTION_STATE_ACTIVE',

  /**
   * Subscription is paused. The state is only available when the subscription is an auto renewing
   * plan. In this state, all items are in paused state.
   */
  SUBSCRIPTION_STATE_PAUSED = 'SUBSCRIPTION_STATE_PAUSED',

  /**
   * Subscription is in grace period. The state is only available when the subscription is an auto
   * renewing plan. In this state, all items are in grace period.
   */
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD = 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',

  /**
   * Subscription is on hold (suspended). The state is only available when the subscription is an
   * auto renewing plan. In this state, all items are on hold.
   */
  SUBSCRIPTION_STATE_ON_HOLD = 'SUBSCRIPTION_STATE_ON_HOLD',

  /**
   * Subscription is canceled but not expired yet. The state is only available when the subscription
   * is an auto renewing plan. All items have autoRenewEnabled set to false.
   */
  SUBSCRIPTION_STATE_CANCELED = 'SUBSCRIPTION_STATE_CANCELED',

  /** Subscription is expired. All items have expiryTime in the past. */
  SUBSCRIPTION_STATE_EXPIRED = 'SUBSCRIPTION_STATE_EXPIRED',

  /**
   * Pending transaction for subscription is canceled. If this pending purchase was for an existing
   * subscription, use linkedPurchaseToken to get the current state of that subscription.
   */
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED = 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
}
