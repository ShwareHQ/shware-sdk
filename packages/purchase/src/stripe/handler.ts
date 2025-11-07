import Stripe from 'stripe';

type StripeEventObject<T extends Stripe.Event.Type> = Extract<
  Stripe.Event,
  { type: T }
>['data']['object'];

type EventHandlerFn<T extends Stripe.Event.Type = Stripe.Event.Type> = (
  object: StripeEventObject<T>
) => Promise<void>;

export class StripeEventHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers: Map<Stripe.Event.Type, Array<EventHandlerFn<any>>>;

  private constructor() {
    this.handlers = new Map();
  }

  static create() {
    return new StripeEventHandler();
  }

  on = <T extends Stripe.Event.Type>(type: T, handler: EventHandlerFn<T>) => {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }

    this.handlers.get(type)?.push(handler);
    return this;
  };

  process = async (event: Stripe.Event): Promise<void> => {
    const eventHandlers = this.handlers.get(event.type);
    if (eventHandlers) {
      await Promise.all(eventHandlers.map((handler) => handler(event.data.object)));
    } else {
      console.error(`No stripe event handler found for event type: ${event.type}`);
      throw new Error(`No stripe event handler found for event type: ${event.type}`);
    }
  };
}
