import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  NotificationTypeV2,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

export interface AppStoreNotificationEvent {
  payload: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
}

type NotificationHandlerFn = (event: AppStoreNotificationEvent) => Promise<void>;

/**
 * App Store Server Notification dispatcher keyed by notificationType, the app-store counterpart
 * of StripeEventHandler. The caller verifies and decodes the notification (payload, transaction,
 * renewalInfo) first and passes the decoded event in. Subtype branching stays inside each
 * handler: Apple subtypes share the handler's derived context and are usually a few lines each.
 */
export class AppStoreNotificationHandler {
  private readonly handlers: Map<NotificationTypeV2, NotificationHandlerFn[]>;

  private constructor() {
    this.handlers = new Map();
  }

  static create() {
    return new AppStoreNotificationHandler();
  }

  on = (type: NotificationTypeV2, handler: NotificationHandlerFn) => {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }

    this.handlers.get(type)?.push(handler);
    return this;
  };

  process = async (event: AppStoreNotificationEvent): Promise<void> => {
    const type = event.payload.notificationType as NotificationTypeV2 | undefined;
    const handlers = type ? this.handlers.get(type) : undefined;
    if (!handlers) {
      console.error(`No app store notification handler found for type: ${type}`);
      throw new Error(`No app store notification handler found for type: ${type}`);
    }
    await Promise.all(handlers.map((handler) => handler(event)));
  };
}
