import { invariant } from '@shware/utils';
import ms, { type StringValue } from 'ms';

export type PriceId = `price_${string}`;
export type ProductId = Lowercase<string>;
export type CreditConfig = { credits: number; expiresIn: StringValue };

const addMethod = Symbol('addMethod');

class Product<P extends ProductId = ProductId, I extends PriceId = never> {
  readonly id: P;
  readonly config: StripeConfig;
  readonly plan: string | null;
  readonly prices: Map<PriceId, CreditConfig>;

  defaultPriceId: I | null;

  private constructor(config: StripeConfig, id: P, plan: string | null = null) {
    this.id = id;
    this.config = config;
    this.plan = plan;
    this.prices = new Map();
    this.defaultPriceId = null;
  }

  static create = <P extends ProductId>(
    config: StripeConfig,
    id: P,
    plan: string | null = null
  ) => {
    return new Product<P>(config, id, plan);
  };

  price = <K extends PriceId>(
    priceId: K,
    credit: CreditConfig = { credits: 0, expiresIn: '0' }
  ): Product<P, I | K> => {
    this.prices.set(priceId, credit);
    return this as Product<P, I | K>;
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
  allowPromotionCodes: boolean;
};

export class StripeConfig {
  private products: Map<ProductId, Product> = new Map();

  public returnUrl: string;
  public cancelUrl: string;
  public successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  public allowPromotionCodes: boolean;

  get productIds(): ProductId[] {
    return Array.from(this.products.keys());
  }

  [addMethod] = (product: Product) => {
    this.products.set(product.id, product);
    return this;
  };

  private constructor(options: Options) {
    this.returnUrl = options.returnUrl;
    this.cancelUrl = options.cancelUrl;
    this.successUrl = options.successUrl;
    this.allowPromotionCodes = options.allowPromotionCodes;
  }

  static create = (options: Options) => {
    return new StripeConfig(options);
  };

  product = (id: ProductId, plan: string | null = null) => {
    return Product.create(this, id, plan);
  };

  getPlan = (productId: string): string => {
    const plan = this.products.get(productId as ProductId)?.plan;
    if (!plan) throw new Error(`Plan not found for product ${productId}`);
    return plan;
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    const product = this.products.get(productId as ProductId);
    invariant(product, `Product not found for ${productId}`);
    return product.plan === null ? 'payment' : 'subscription';
  };

  getPriceId = (productId: string): PriceId => {
    const product = this.products.get(productId as ProductId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.defaultPriceId, `Default price not found for product ${productId}`);
    return product.defaultPriceId;
  };

  getCreditAmount = (productId: string, priceId?: string): number => {
    const product = this.products.get(productId as ProductId);
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
    const product = this.products.get(productId as ProductId);
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
