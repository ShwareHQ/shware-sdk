import { invariant } from '@shware/utils';
import ms from 'ms';
import type { Metadata } from '../types';

const addMethod = Symbol('addMethod');

class Subscription<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PL extends string = never,
  PI extends string = never,
  I extends string = never,
> {
  readonly plan: PE;
  readonly billingPeriod: BP;
  readonly config: AppStoreConfig<NS, PE, BP, PL, PI>;
  readonly products: Map<string, Metadata>;

  defaultProductId: I | null;

  constructor(config: AppStoreConfig<NS, PE, BP, PL, PI>, plan: PE, billingPeriod: BP) {
    this.plan = plan;
    this.billingPeriod = billingPeriod;
    this.config = config;
    this.products = new Map();
    this.defaultProductId = null;
  }

  /**
   * Non-default products stay declared on purpose: they keep resolving for
   * grandfathered subscribers and serve as price-experiment arms. Never
   * sell a legacy product to new users unless that is intentional.
   */
  product = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ): Subscription<NS, PE, BP, PL, PI | K, I | K> => {
    invariant(!this.products.has(productId), `Duplicate product ${productId}`);
    this.products.set(productId, metadata);
    return this as Subscription<NS, PE, BP, PL, PI | K, I | K>;
  };

  default = (defaultProductId: I) => {
    invariant(
      this.products.has(defaultProductId),
      `Default product ${defaultProductId} is not declared`
    );
    this.defaultProductId = defaultProductId;
    this.config[addMethod](this as never);
    return this.config;
  };
}

type Options = { appId: `${number}`; bundleId: string };

export class AppStoreConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PL extends string = never,
  PI extends string = never,
> {
  readonly appId: string;
  readonly bundleId: string;

  private products: Map<string, Metadata | null>;
  private consumables: Set<string>;
  private subscriptions: Map<string, Subscription<NS, PE, BP, PL, PI>>;
  private nonConsumables: Set<string>;

  get productIds(): string[] {
    return Array.from(this.products.keys());
  }

  // runtime mirror of the type-level guards: generic accumulation only
  // protects a single fluent chain, not statement-style re-entry or casts
  [addMethod] = (subscription: Subscription<NS, PE, BP, PL, PI>) => {
    const key = `${subscription.plan}:${subscription.billingPeriod}`;
    invariant(!this.subscriptions.has(key), `Duplicate plan ${key}`);
    subscription.products.forEach((metadata, productId) => {
      invariant(!this.products.has(productId), `Duplicate product ${productId}`);
      this.products.set(productId, metadata);
    });
    this.subscriptions.set(key, subscription);
    return this;
  };

  private constructor(options: Options) {
    this.appId = options.appId;
    this.bundleId = options.bundleId;
    this.products = new Map();
    this.consumables = new Set();
    this.subscriptions = new Map();
    this.nonConsumables = new Set();
  }

  static create = <NS extends Lowercase<string>, PE extends string, BP extends string = string>(
    options: Options
  ) => {
    return new AppStoreConfig<NS, PE, BP>(options);
  };

  /** The same plan may be declared once per billing period; duplicate pairs are rejected. */
  subscription = <K extends PE, P extends BP>(
    plan: K,
    billingPeriod: `${K}:${P}` extends PL ? never : P
  ) => {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc requires the cast (tsgolint false positive)
    return new Subscription<NS, PE, BP, `${K}:${P}` | PL, PI>(this as never, plan, billingPeriod);
  };

  consumable = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ) => {
    invariant(!this.products.has(productId), `Duplicate product ${productId}`);
    this.consumables.add(productId);
    this.products.set(productId, metadata);
    return this as AppStoreConfig<NS, PE, BP, PL, PI | K>;
  };

  nonConsumable = <K extends `${NS}.${Lowercase<string>}`>(productId: K extends PI ? never : K) => {
    invariant(!this.products.has(productId), `Duplicate product ${productId}`);
    this.nonConsumables.add(productId);
    this.products.set(productId, null);
    return this as AppStoreConfig<NS, PE, BP, PL, PI | K>;
  };

  /** Product id that new subscribers should purchase for the plan and billing period. */
  getDefaultProductId = (plan: PE, billingPeriod: BP): string => {
    const subscription = this.subscriptions.get(`${plan}:${billingPeriod}`);
    invariant(subscription, `Subscription not found for ${plan}:${billingPeriod}`);
    invariant(
      subscription.defaultProductId,
      `Default product not found for ${plan}:${billingPeriod}`
    );
    return subscription.defaultProductId;
  };

  getPlan = (productId: string): PE => {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.products.has(productId)) return subscription.plan;
    }
    throw new Error(`Plan not found for product ${productId}`);
  };

  getBillingPeriod = (productId: string): BP => {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.products.has(productId)) return subscription.billingPeriod;
    }
    throw new Error(`Billing period not found for product ${productId}`);
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    if (this.consumables.has(productId) || this.nonConsumables.has(productId)) return 'payment';
    for (const subscription of this.subscriptions.values()) {
      if (subscription.products.has(productId)) return 'subscription';
    }
    throw new Error(`Mode not found for product ${productId}`);
  };

  getCreditAmount = (productId: string): number => {
    const config = this.products.get(productId);
    invariant(config !== undefined, `Product not found for ${productId}`);
    invariant(config !== null, `Credits not available for non-consumable product ${productId}`);
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
