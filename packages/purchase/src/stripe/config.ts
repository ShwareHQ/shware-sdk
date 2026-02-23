import { invariant } from '@shware/utils';
import ms from 'ms';
import type { Metadata } from '../types';

export type PriceId = `price_${string}`;

const addMethod = Symbol('addMethod');

class Product<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PI extends string = never,
  I extends PriceId = never,
> {
  readonly id: string;
  readonly config: StripeConfig<NS, PE, PI>;
  readonly plan: PE | null;
  readonly prices: Map<PriceId, Metadata>;

  defaultPriceId: I | null;

  constructor(config: StripeConfig<NS, PE, PI>, id: string, plan: PE | null = null) {
    this.id = id;
    this.config = config;
    this.plan = plan;
    this.prices = new Map();
    this.defaultPriceId = null;
  }

  price = <K extends PriceId>(
    priceId: K extends I ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ): Product<NS, PE, PI, I | K> => {
    this.prices.set(priceId, metadata);
    return this as Product<NS, PE, PI, I | K>;
  };

  default = (defaultPriceId: I) => {
    this.defaultPriceId = defaultPriceId;
    this.config[addMethod](this as never);
    return this.config;
  };
}

type Options = {
  returnUrl: string;
  cancelUrl: string;
  successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  cancellationCouponId: string;
  allowPromotionCodes: boolean;
};

export class StripeConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  PI extends string = never,
> {
  private products: Map<string, Product<NS, PE, PI>> = new Map();

  public returnUrl: string;
  public cancelUrl: string;
  public successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  public cancellationCouponId: string;
  public allowPromotionCodes: boolean;

  get productIds(): string[] {
    return Array.from(this.products.keys());
  }

  [addMethod] = (product: Product<NS, PE, PI>) => {
    this.products.set(product.id, product);
    return this;
  };

  private constructor(options: Options) {
    this.returnUrl = options.returnUrl;
    this.cancelUrl = options.cancelUrl;
    this.successUrl = options.successUrl;
    this.cancellationCouponId = options.cancellationCouponId;
    this.allowPromotionCodes = options.allowPromotionCodes;
  }

  static create = <NS extends Lowercase<string>, PE extends string>(options: Options) => {
    return new StripeConfig<NS, PE>(options);
  };

  product = <K extends `${NS}.${Lowercase<string>}`>(
    productId: K extends PI ? never : K,
    plan: PE | null = null
  ) => {
    return new Product<NS, PE, K | PI>(this, productId, plan);
  };

  getPlan = (productId: string): PE => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.plan, `Product ${productId} is not a subscription`);
    return product.plan;
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    return product.plan === null ? 'payment' : 'subscription';
  };

  getPriceId = (productId: string): PriceId => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.defaultPriceId, `Default price not found for product ${productId}`);
    return product.defaultPriceId;
  };

  getCreditAmount = (productId: string, priceId?: string): number => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    if (priceId) {
      const price = product.prices.get(priceId as PriceId);
      invariant(price, `Price not found for ${priceId}`);
      return price.credits;
    }

    invariant(product.defaultPriceId, `Default price not found for product ${productId}`);
    return product.prices.get(product.defaultPriceId)?.credits ?? 0;
  };

  private getCreditExpiresIn = (productId: string, priceId?: string): number => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    if (priceId) {
      const price = product.prices.get(priceId as PriceId);
      invariant(price, `Price not found for ${priceId}`);
      return ms(price.expiresIn);
    }

    invariant(product.defaultPriceId, `Default price not found for product ${productId}`);
    return ms(product.prices.get(product.defaultPriceId)?.expiresIn ?? '0');
  };

  getCreditExpiresAt = (productId: string, priceId?: string): string => {
    const expiresIn = this.getCreditExpiresIn(productId, priceId);
    return new Date(Date.now() + expiresIn).toISOString();
  };
}
