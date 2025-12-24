import { invariant } from '@shware/utils';
import ms from 'ms';
import type { IsUnique, Metadata } from '../types';

const addMethod = Symbol('addMethod');

class Subscription<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PI extends string = never,
  I extends Lowercase<string> = never,
> {
  readonly productId: string;
  readonly config: GooglePlayConfig<NS, PE, PI>;
  readonly plans: Map<string, Metadata & { plan?: PE }>;
  readonly defaultPlans: Set<string>;

  constructor(config: GooglePlayConfig<NS, PE, PI>, productId: string) {
    this.config = config;
    this.productId = productId;
    this.plans = new Map();
    this.defaultPlans = new Set();
  }

  basePlan = <K extends Lowercase<string>>(
    planId: K extends I ? never : K,
    plan: PE,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ): Subscription<NS, PE, PI, I | K> => {
    this.plans.set(planId, { ...metadata, plan });
    return this as Subscription<NS, PE, PI, I | K>;
  };

  default = <const T extends readonly [I, ...I[]]>(
    planIds: T & (IsUnique<T> extends true ? unknown : never)
  ) => {
    planIds.forEach((planId) => this.defaultPlans.add(planId));
    this.config[addMethod](this as never);
    return this.config;
  };
}

type Options = { package: string; audience: string };

export class GooglePlayConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PI extends string = never,
> {
  readonly package: string;
  readonly audience: string;
  private onetimes: Set<string>;
  private subscriptions: Map<string, Subscription<NS, PE, PI>>;
  private products: Map<string, (Metadata & { plan?: PE }) | null>;

  [addMethod] = (subscription: Subscription<NS, PE, PI>) => {
    subscription.plans.forEach((metadata, planId) => {
      this.products.set(this.getId(subscription.productId, planId), metadata);
    });
    this.subscriptions.set(subscription.productId, subscription);
    return this;
  };

  private getId = (productId: string, planId: string) => `${productId}:${planId}`;

  private constructor(options: Options) {
    this.package = options.package;
    this.audience = options.audience;
    this.products = new Map();
    this.onetimes = new Set();
    this.subscriptions = new Map();
  }

  static create = <NS extends Lowercase<string>, PE extends string = string>(options: Options) => {
    return new GooglePlayConfig<NS, PE>(options);
  };

  subscription = <K extends `${NS}.${Lowercase<string>}`>(productId: K extends PI ? never : K) => {
    return new Subscription<NS, PE, PI | K>(this, productId);
  };

  onetime = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ) => {
    this.onetimes.add(productId);
    this.products.set(productId, metadata);
    return this as GooglePlayConfig<NS, PE, PI | K>;
  };

  getPlan = (productId: string, planId: string): PE => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    invariant(metadata.plan, `Plan not found for ${id}`);
    return metadata.plan;
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    if (this.onetimes.has(productId)) return 'payment';
    if (this.subscriptions.has(productId)) return 'subscription';
    throw new Error(`Mode not found for product ${productId}`);
  };

  getCreditAmount = (productId: string, planId: string): number => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    return metadata.credits;
  };

  private getCreditExpiresIn = (productId: string, planId: string): number => {
    const id = this.getId(productId, planId);
    const metadata = this.products.get(id);
    invariant(metadata, `Product not found for ${id}`);
    return ms(metadata.expiresIn);
  };

  getCreditExpiresAt = (productId: string, planId: string): string => {
    const expiresIn = this.getCreditExpiresIn(productId, planId);
    return new Date(Date.now() + expiresIn).toISOString();
  };
}
