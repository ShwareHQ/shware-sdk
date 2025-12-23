import { invariant } from '@shware/utils';
import ms, { type StringValue } from 'ms';

export type CreditConfig = { credits: number; expiresIn: StringValue };

const addMethod = Symbol('addMethod');

class Subscription<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PL extends PE = never,
  PI extends string = never,
  I extends string = never,
> {
  readonly plan: PL;
  readonly config: AppStoreConfig<NS, PE, PL, PI>;
  readonly products: Map<string, CreditConfig>;

  defaultProductId: I | null;

  constructor(config: AppStoreConfig<NS, PE, PL, PI>, plan: PL) {
    this.plan = plan;
    this.config = config;
    this.products = new Map();
    this.defaultProductId = null;
  }

  product = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    credit: CreditConfig = { credits: 0, expiresIn: '0' }
  ): Subscription<NS, PE, PL, PI | K, I | K> => {
    this.products.set(productId, credit);
    return this as Subscription<NS, PE, PL, PI | K, I | K>;
  };

  default = (defaultProductId: I) => {
    this.defaultProductId = defaultProductId;
    this.config[addMethod](this as never);
    return this.config;
  };
}

export class AppStoreConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PL extends PE = never,
  PI extends string = never,
> {
  private products: Map<string, CreditConfig>;
  private subscriptions: Map<PE, Subscription<NS, PE, PL, PI>>;

  get productIds(): string[] {
    return Array.from(this.products.keys());
  }

  [addMethod] = (subscription: Subscription<NS, PE, PL, PI>) => {
    subscription.products.forEach((credit, productId) => this.products.set(productId, credit));
    this.subscriptions.set(subscription.plan, subscription);
    return this;
  };

  private constructor() {
    this.products = new Map();
    this.subscriptions = new Map();
  }

  static create = <NS extends Lowercase<string>, PE extends string>() => {
    return new AppStoreConfig<NS, PE>();
  };

  subscription = <K extends PE>(plan: K extends PL ? never : K) => {
    return new Subscription<NS, PE, K | PL, PI>(this, plan);
  };

  getCreditAmount = (productId: string): number => {
    const config = this.products.get(productId);
    invariant(config, `Product not found for ${productId}`);
    return config.credits;
  };

  private getCreditExpiresIn = (productId: string): number => {
    const config = this.products.get(productId);
    invariant(config, `Product not found for ${productId}`);
    return ms(config.expiresIn);
  };

  getCreditExpiresAt = (productId: string): string => {
    const expiresIn = this.getCreditExpiresIn(productId);
    return new Date(Date.now() + expiresIn).toISOString();
  };
}
