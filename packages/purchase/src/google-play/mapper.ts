import type { SubscriptionStatus } from '../subscription/index';
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
