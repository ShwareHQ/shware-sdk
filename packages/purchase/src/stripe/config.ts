import { invariant } from '@shware/utils';
import ms from 'ms';
import type { Metadata } from '../types';

export type PriceId = `price_${string}`;

/**
 * Which Stripe object space the config addresses. Test and live prices are
 * disjoint, so a config is built for exactly one of them. Derive it from the
 * secret key (`sk_test_` vs `sk_live_`) rather than from the deployment
 * environment: the key is what actually decides which space API calls hit.
 */
export type StripeMode = 'live' | 'test';

const addMethod = Symbol('addMethod');

class Product<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PL extends string = never,
  PI extends string = never,
  I extends PriceId = never,
> {
  readonly id: string;
  readonly config: StripeConfig<NS, PE, BP, PL, PI>;
  readonly plan: PE | null;
  readonly billingPeriod: BP | null;
  readonly prices: Map<PriceId, Metadata>;

  defaultPriceId: PriceId | null;

  constructor(
    config: StripeConfig<NS, PE, BP, PL, PI>,
    id: string,
    plan: PE | null = null,
    billingPeriod: BP | null = null
  ) {
    this.id = id;
    this.config = config;
    this.plan = plan;
    this.billingPeriod = billingPeriod;
    this.prices = new Map();
    this.defaultPriceId = null;
  }

  /**
   * Non-default prices stay declared on purpose: they keep resolving for
   * grandfathered subscribers and serve as price-experiment arms. Never
   * create new checkouts with a legacy price unless that is intentional.
   */
  price = <K extends PriceId>(
    priceId: K extends I ? never : K,
    metadata: Metadata = { credits: 0, expiresIn: '0' }
  ): Product<NS, PE, BP, PL, PI, I | K> => {
    invariant(!this.prices.has(priceId), `Duplicate price ${priceId}`);
    this.prices.set(priceId, metadata);
    return this as Product<NS, PE, BP, PL, PI, I | K>;
  };

  /**
   * `test` is the sandbox twin of the default price. In test mode it is what
   * checkouts are created with, and it resolves to the default price's
   * entitlement, so credits are declared once and cannot drift between the
   * two modes. Legacy prices need no twin: a sandbox holds no grandfathered
   * subscribers. Live mode ignores it, so a test price reaching a live config
   * still fails as an unknown price instead of being granted an entitlement.
   */
  default = (defaultPriceId: I, twin?: { test: PriceId }) => {
    const metadata = this.prices.get(defaultPriceId);
    invariant(metadata, `Default price ${defaultPriceId} is not declared`);
    if (this.config.mode === 'test') {
      invariant(twin, `Test price not declared for default ${defaultPriceId} of ${this.id}`);
      invariant(!this.prices.has(twin.test), `Duplicate price ${twin.test}`);
      this.prices.set(twin.test, metadata);
      this.defaultPriceId = twin.test;
    } else {
      this.defaultPriceId = defaultPriceId;
    }
    this.config[addMethod](this);
    return this.config;
  };
}

type Options = {
  mode: StripeMode;
  returnUrl: string;
  cancelUrl: string;
  successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  cancellationCouponId: string;
  allowPromotionCodes: boolean;
};

export class StripeConfig<
  NS extends Lowercase<string> = Lowercase<string>,
  PE extends string = string,
  BP extends string = string,
  PL extends string = never,
  PI extends string = never,
> {
  private readonly products: Map<string, Product<NS, PE, BP, PL, PI>> = new Map();

  public readonly mode: StripeMode;
  public returnUrl: string;
  public cancelUrl: string;
  public successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  public cancellationCouponId: string;
  public allowPromotionCodes: boolean;

  get productIds(): string[] {
    return Array.from(this.products.keys());
  }

  // runtime mirror of the type-level guards: generic accumulation only
  // protects a single fluent chain, not statement-style re-entry or casts
  [addMethod] = (product: Product<NS, PE, BP, PL, PI>) => {
    invariant(!this.products.has(product.id), `Duplicate product ${product.id}`);
    if (product.plan !== null) {
      for (const existing of this.products.values()) {
        invariant(
          existing.plan !== product.plan || existing.billingPeriod !== product.billingPeriod,
          `Duplicate plan ${product.plan}:${product.billingPeriod}`
        );
      }
    }
    this.products.set(product.id, product);
    return this;
  };

  private constructor(options: Options) {
    this.mode = options.mode;
    this.returnUrl = options.returnUrl;
    this.cancelUrl = options.cancelUrl;
    this.successUrl = options.successUrl;
    this.cancellationCouponId = options.cancellationCouponId;
    this.allowPromotionCodes = options.allowPromotionCodes;
  }

  static create = <NS extends Lowercase<string>, PE extends string, BP extends string = string>(
    options: Options
  ) => {
    return new StripeConfig<NS, PE, BP>(options);
  };

  /**
   * One-time products take no extra args; subscriptions require both plan and billingPeriod.
   * A plan+period pair may be declared on only one product — version its prices in that chain.
   */
  product: {
    <K extends `${NS}.${Lowercase<string>}`>(
      productId: K extends PI ? never : K
    ): Product<NS, PE, BP, PL, K | PI>;
    <K extends `${NS}.${Lowercase<string>}`, L extends PE, P extends BP>(
      productId: K extends PI ? never : K,
      plan: L,
      billingPeriod: `${L}:${P}` extends PL ? never : P
    ): Product<NS, PE, BP, `${L}:${P}` | PL, K | PI>;
  } = (productId: string, plan: PE | null = null, billingPeriod: BP | null = null) =>
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- widens to the overloads' accumulated generics
    new Product(this, productId, plan, billingPeriod) as never;

  getPlan = (productId: string): PE => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.plan, `Product ${productId} is not a subscription`);
    return product.plan;
  };

  getBillingPeriod = (productId: string): BP => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.billingPeriod, `Product ${productId} is not a subscription`);
    return product.billingPeriod;
  };

  getMode = (productId: string): 'payment' | 'subscription' => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    return product.plan === null ? 'payment' : 'subscription';
  };

  /** The price new checkouts are created with: the default, or its test twin in test mode. */
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

  private readonly getCreditExpiresIn = (productId: string, priceId?: string): number => {
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
