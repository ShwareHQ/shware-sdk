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

type Options<NS extends Lowercase<string>, PE extends string, BP extends string> = {
  /** The prefix every product id starts with (`io.example` for `io.example.pro.monthly`). */
  namespace: NS;
  /**
   * Every plan, lowest tier first: the plan's level, as Apple orders a subscription group, which is
   * what {@link StripeConfig.comparePlans} reads an upgrade or a downgrade from. Empty for a config
   * that sells no subscriptions.
   */
  plans: readonly PE[];
  /** Every billing period, shortest first. Empty for a config that sells no subscriptions. */
  billingPeriods: readonly BP[];
  mode: StripeMode;
  returnUrl: string;
  cancelUrl: string;
  successUrl: `${string}session_id={CHECKOUT_SESSION_ID}${string}`;
  cancellationCouponId: string;
  allowPromotionCodes: boolean;
};

/**
 * How a switch between two subscription products relates them, by plan level first and billing
 * period second:
 * - `upgrade` / `downgrade`: a higher or lower plan, whatever the periods.
 * - `longer` / `shorter`: the same plan billed over a longer or shorter period (monthly → yearly
 *   is `longer`). Apple calls these crossgrades.
 * - `same`: the same plan and period.
 */
export type PlanComparison = 'upgrade' | 'downgrade' | 'longer' | 'shorter' | 'same';

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
  public readonly namespace: NS;
  public readonly plans: readonly PE[];
  public readonly billingPeriods: readonly BP[];

  get productIds(): string[] {
    return Array.from(this.products.keys());
  }

  // runtime mirror of the type-level guards: generic accumulation only
  // protects a single fluent chain, not statement-style re-entry or casts
  [addMethod] = (product: Product<NS, PE, BP, PL, PI>) => {
    invariant(!this.products.has(product.id), `Duplicate product ${product.id}`);
    // A Stripe price belongs to one Stripe product, and getProductId must have one answer.
    for (const existing of this.products.values()) {
      for (const priceId of product.prices.keys()) {
        invariant(!existing.prices.has(priceId), `Duplicate price ${priceId} on ${existing.id}`);
      }
    }
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

  private constructor(options: Options<NS, PE, BP>) {
    invariant(new Set(options.plans).size === options.plans.length, 'Duplicate plan in plans');
    invariant(
      new Set(options.billingPeriods).size === options.billingPeriods.length,
      'Duplicate billing period in billingPeriods'
    );
    this.namespace = options.namespace;
    this.plans = options.plans;
    this.billingPeriods = options.billingPeriods;
    this.mode = options.mode;
    this.returnUrl = options.returnUrl;
    this.cancelUrl = options.cancelUrl;
    this.successUrl = options.successUrl;
    this.cancellationCouponId = options.cancellationCouponId;
    this.allowPromotionCodes = options.allowPromotionCodes;
  }

  /**
   * Every type parameter is inferred from the options: the namespace from `namespace`, the plans
   * and billing periods from the arrays (`const`, so a literal array needs no `as const`).
   */
  static create = <
    const NS extends Lowercase<string>,
    const PE extends string,
    const BP extends string,
  >(
    options: Options<NS, PE, BP>
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
  } = (productId: string, plan: PE | null = null, billingPeriod: BP | null = null) => {
    // runtime mirror of the template-literal and union types, for ids built at runtime or cast
    invariant(
      productId.startsWith(`${this.namespace}.`),
      `Product ${productId} is not in namespace ${this.namespace}`
    );
    invariant(plan === null || this.plans.includes(plan), `Plan ${plan} is not in plans`);
    invariant(
      billingPeriod === null || this.billingPeriods.includes(billingPeriod),
      `Billing period ${billingPeriod} is not in billingPeriods`
    );
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- widens to the overloads' accumulated generics
    return new Product(this, productId, plan, billingPeriod) as never;
  };

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

  /**
   * Whether the config declares `productId` and sells it as a subscription, so `getPlan` and
   * `getBillingPeriod` hold for it. False, not a throw, for an id it does not know: a product that
   * left the config (renamed, retired) or one named by metadata set outside the app.
   */
  isSubscription = (productId: string): boolean => {
    const product = this.products.get(productId);
    return product !== undefined && product.plan !== null;
  };

  /** The price new checkouts are created with: the default, or its test twin in test mode. */
  getPriceId = (productId: string): PriceId => {
    const product = this.products.get(productId);
    invariant(product, `Product not found for ${productId}`);
    invariant(product.defaultPriceId, `Default price not found for product ${productId}`);
    return product.defaultPriceId;
  };

  /**
   * The product that declares `priceId` (a legacy price or the test twin included), or null for a
   * price this config does not know: one set up by hand in the dashboard, or a test price reaching
   * a live config. Reading the product from the price a Stripe object charged, rather than from
   * metadata that may already name the next plan, is what an invoice should be credited by.
   */
  getProductId = (priceId: string): string | null => {
    for (const product of this.products.values()) {
      if (product.prices.has(priceId as PriceId)) return product.id;
    }
    return null;
  };

  /**
   * How switching from one subscription product to another relates them (see
   * {@link PlanComparison}), by the order `plans` and `billingPeriods` were declared in. Throws for
   * a product that is not a subscription.
   */
  comparePlans = (fromProductId: string, toProductId: string): PlanComparison => {
    const level = (productId: string) => ({
      plan: this.plans.indexOf(this.getPlan(productId)),
      period: this.billingPeriods.indexOf(this.getBillingPeriod(productId)),
    });
    const from = level(fromProductId);
    const to = level(toProductId);
    if (to.plan !== from.plan) return to.plan > from.plan ? 'upgrade' : 'downgrade';
    if (to.period !== from.period) return to.period > from.period ? 'longer' : 'shorter';
    return 'same';
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
