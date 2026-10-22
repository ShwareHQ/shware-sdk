import type { Stripe } from 'stripe';

type StripeEventNotification = Stripe.V2.Core.EventNotification;

export type StripeEventType = StripeEventNotification['type'];

export type StripeEventNotificationOf<T extends StripeEventType> = Extract<
  StripeEventNotification,
  { type: T }
>;

type EventHandlerFn<T extends StripeEventType = StripeEventType> = (
  notification: StripeEventNotificationOf<T>
) => Promise<void>;

/**
 * Stripe thin event dispatcher keyed by event type (`v1.customer.subscription.updated`, ...). The
 * caller verifies and parses the payload with `stripe.parseEventNotificationAsync` first and passes
 * the notification in. A thin event only says which object changed, so each handler reads current
 * state itself with `notification.fetchRelatedObject()` (or `fetchEvent()`). Nothing is pre-fetched
 * here: some handlers only need `related_object.id`, and fetching inside the handler keeps the API
 * call next to the code that uses its result. Delivery order carries no meaning: handlers re-read
 * state instead of applying a payload, and dedupe one-off facts with idempotency keys.
 */
export class StripeEventHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers: Map<StripeEventType, Array<EventHandlerFn<any>>>;

  private constructor() {
    this.handlers = new Map();
  }

  static create() {
    return new StripeEventHandler();
  }

  on = <T extends StripeEventType>(type: T, handler: EventHandlerFn<T>) => {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }

    this.handlers.get(type)?.push(handler);
    return this;
  };

  process = async (notification: StripeEventNotification): Promise<void> => {
    const eventHandlers = this.handlers.get(notification.type);
    if (eventHandlers) {
      await Promise.all(eventHandlers.map((handler) => handler(notification)));
    } else {
      console.error(`No stripe event handler found for event type: ${notification.type}`);
      throw new Error(`No stripe event handler found for event type: ${notification.type}`);
    }
  };
}
