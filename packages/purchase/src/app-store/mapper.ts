import type { CancellationDetails } from '../subscription/index';

/**
 * The App Store Server Notification fields that say why a subscription stops renewing: the
 * notification type and subtype, plus `expirationIntent` from the renewal info once it has
 * expired. Strings and numbers as Apple sends them, so this needs no runtime import of the
 * App Store Server Library.
 */
export interface AppStoreCancellationSource {
  notificationType: string;
  subtype?: string | null;
  /** `JWSRenewalInfoDecodedPayload.expirationIntent`: 1 customer, 2 billing, 3 price increase, 4 unavailable, 5 other. */
  expirationIntent?: number | null;
}

/**
 * Who ended an App Store subscription and why, from the notification that reported it. Null for
 * anything that is not a cancellation, including the customer turning auto-renew back on.
 *
 * ref: [notificationType](https://developer.apple.com/documentation/appstoreservernotifications/notificationtype)
 * ref: [expirationIntent](https://developer.apple.com/documentation/appstoreserverapi/expirationintent)
 */
export function mapCancellationDetails(
  source: AppStoreCancellationSource
): CancellationDetails | null {
  const { notificationType, subtype, expirationIntent } = source;
  const details = (initiator: CancellationDetails['initiator'], reason: string) => ({
    initiator,
    reason,
    feedback: null,
    comment: null,
  });

  switch (notificationType) {
    case 'DID_CHANGE_RENEWAL_STATUS':
      return subtype === 'AUTO_RENEW_DISABLED' ? details('user', subtype) : null;
    case 'EXPIRED':
      switch (subtype ?? expirationIntentSubtype(expirationIntent)) {
        case 'VOLUNTARY':
          return details('user', 'VOLUNTARY');
        case 'BILLING_RETRY':
          return details('system', 'BILLING_RETRY');
        case 'PRICE_INCREASE':
          return details('user', 'PRICE_INCREASE');
        case 'PRODUCT_NOT_FOR_SALE':
          return details('developer', 'PRODUCT_NOT_FOR_SALE');
        default:
          return details('system', 'EXPIRED');
      }
    case 'DID_FAIL_TO_RENEW':
    case 'GRACE_PERIOD_EXPIRED':
    case 'REFUND':
    case 'REVOKE':
      return details('system', notificationType);
    default:
      return null;
  }
}

/** The EXPIRED subtype Apple would have sent for an `expirationIntent`. */
function expirationIntentSubtype(intent: number | null | undefined) {
  switch (intent) {
    case 1:
      return 'VOLUNTARY';
    case 2:
      return 'BILLING_RETRY';
    case 3:
      return 'PRICE_INCREASE';
    case 4:
      return 'PRODUCT_NOT_FOR_SALE';
    default:
      return undefined;
  }
}
