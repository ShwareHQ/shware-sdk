import { invariant } from '@shware/utils';
import ms from 'ms';
import type { IsUnique, Metadata } from '../types';

const addMethod = Symbol('addMethod');

class Subscription<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PI extends string = never,
  I extends Lowercase<string> = never,
> {
  readonly productId: string;
  readonly config: GooglePlayConfig<NS, PE, BP, PI>;
  readonly plans: Map<string, Metadata & { plan?: PE; billingPeriod?: BP }>;
  readonly defaultPlans: Set<string>;

  constructor(config: GooglePlayConfig<NS, PE, BP, PI>, productId: string) {
    this.config = config;
    this.productId = productId;
    this.plans = new Map();
    this.defaultPlans = new Set();
  }

  /**
   * Non-default base plans stay declared on purpose: they keep resolving for
   * grandfathered subscribers and serve as price-experiment arms. Never sell
   * a legacy base plan to new users unless that is intentional.
   */
  basePlan = <K extends Lowercase<string>>(
    planId: K extends I ? never : K,
    plan: PE,
    billingPeriod: BP,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ): Subscription<NS, PE, BP, PI, I | K> => {
    invariant(!this.plans.has(planId), `Duplicate base plan ${planId}`);
    this.plans.set(planId, { ...metadata, plan, billingPeriod });
    return this;
  };

  default = <const T extends readonly [I, ...I[]]>(
    planIds: T & (IsUnique<T> extends true ? unknown : never)
  ) => {
    planIds.forEach((planId) => {
      invariant(this.plans.has(planId), `Default base plan ${planId} is not declared`);
      this.defaultPlans.add(planId);
    });
    this.config[addMethod](this);
    return this.config;
  };
}

type Options = { package: string; audience: string };

export class GooglePlayConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PI extends string = never,
> {
  readonly package: string;
  readonly audience: string;
  private onetimes: Set<string>;
  private subscriptions: Map<string, Subscription<NS, PE, BP, PI>>;
  private products: Map<string, (Metadata & { plan?: PE; billingPeriod?: BP }) | null>;

  // runtime mirror of the type-level guards: generic accumulation only
  // protects a single fluent chain, not statement-style re-entry or casts
  [addMethod] = (subscription: Subscription<NS, PE, BP, PI>) => {
    invariant(
      !this.subscriptions.has(subscription.productId),
      `Duplicate subscription ${subscription.productId}`
    );
    subscription.plans.forEach((metadata, planId) => {
      const id = this.getId(subscription.productId, planId);
      invariant(!this.products.has(id), `Duplicate product ${id}`);
      this.products.set(id, metadata);
    });
    this.subscriptions.set(subscription.productId, subscription);
    return this;
  };

  private getId = (productId: string, planId?: string) => {
    return planId ? `${productId}:${planId}` : productId;
  };

  private constructor(options: Options) {
    this.package = options.package;
    this.audience = options.audience;
    this.products = new Map();
    this.onetimes = new Set();
    this.subscriptions = new Map();
  }

  static create = <
    NS extends Lowercase<string>,
    PE extends string = string,
    BP extends string = string,
  >(
    options: Options
  ) => {
    return new GooglePlayConfig<NS, PE, BP>(options);
  };

  subscription = <K extends `${NS}.${Lowercase<string>}`>(productId: K extends PI ? never : K) => {
    return new Subscription<NS, PE, BP, PI | K>(this, productId);
  };

  onetime = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ) => {
    invariant(!this.products.has(productId), `Duplicate product ${productId}`);
    this.onetimes.add(productId);
    this.products.set(productId, metadata);
    return this as GooglePlayConfig<NS, PE, BP, PI | K>;
  };

  /** Base plan ids that new subscribers should purchase for the product. */
  getDefaultPlanIds = (productId: string): string[] => {
    const subscription = this.subscriptions.get(productId);
    invariant(subscription, `Subscription not found for ${productId}`);
    return Array.from(subscription.defaultPlans);
  };

  getPlan = (productId: string, planId: string): PE => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    invariant(metadata.plan, `Plan not found for ${id}`);
    return metadata.plan;
  };

  getBillingPeriod = (productId: string, planId: string): BP => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    invariant(metadata.billingPeriod, `Billing period not found for ${id}`);
    return metadata.billingPeriod;
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    if (this.onetimes.has(productId)) return 'payment';
    if (this.subscriptions.has(productId)) return 'subscription';
    throw new Error(`Mode not found for product ${productId}`);
  };

  getCreditAmount = (productId: string, planId?: string): number => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    return metadata.credits;
  };

  private getCreditExpiresIn = (productId: string, planId?: string): number => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    return ms(metadata.expiresIn);
  };

  getCreditExpiresAt = (productId: string, planId?: string): string => {
    const expiresIn = this.getCreditExpiresIn(productId, planId);
    return new Date(Date.now() + expiresIn).toISOString();
  };
}
