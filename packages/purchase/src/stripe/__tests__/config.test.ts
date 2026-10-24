import { describe, expect, it, vi } from 'vitest';
import { StripeConfig } from '../config';

describe('StripeConfig', () => {
  const options = {
    namespace: 'io.x',
    plans: [],
    billingPeriods: [],
    mode: 'live',
    allowPromotionCodes: false,
    cancellationCouponId: 'coupon_1',
    returnUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
    successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
  } as const;
  const PLANS = ['STARTER'] as const;

  const BILLING_PERIODS = ['monthly', 'yearly'] as const;

  const config = StripeConfig.create({
    namespace: 'com.example',
    plans: PLANS,
    billingPeriods: BILLING_PERIODS,
    mode: 'live',
    allowPromotionCodes: true,
    cancellationCouponId: 'coupon_123456',
    returnUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
    successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
  })
    // One-time payment product with multiple prices
    .product('com.example.credits.starter')
    .price('price_credits_100', { credits: 100, expiresIn: '30d' })
    .price('price_credits_500', { credits: 500, expiresIn: '60d' })
    .default('price_credits_100')
    // Subscription product
    .product('com.example.sub.starter', 'STARTER', 'monthly')
    .price('price_starter_monthly1', { credits: 1000, expiresIn: '30d' })
    .price('price_starter_monthly2', { credits: 12000, expiresIn: '365d' })
    .default('price_starter_monthly1')
    // Same plan, different billing period
    .product('com.example.sub.starter.yearly', 'STARTER', 'yearly')
    .price('price_starter_yearly1', { credits: 12000, expiresIn: '365d' })
    .default('price_starter_yearly1', { test: 'price_starter_yearly1_test' })
    // Free tier (no credits)
    .product('com.example.free')
    .price('price_free')
    .default('price_free');

  it('should manage products correctly', () => {
    expect(config.productIds).toHaveLength(4);
    expect(config.productIds).toContain('com.example.credits.starter');
    expect(config.productIds).toContain('com.example.sub.starter');
    expect(config.productIds).toContain('com.example.sub.starter.yearly');
    expect(config.productIds).toContain('com.example.free');
  });

  it('should return correct mode and plan', () => {
    // payment mode (no plan)
    expect(config.getMode('com.example.credits.starter')).toBe('payment');
    expect(config.getMode('com.example.free')).toBe('payment');
    expect(() => config.getPlan('com.example.credits.starter')).toThrow(
      'Product com.example.credits.starter is not a subscription'
    );

    // subscription mode (has plan)
    expect(config.getMode('com.example.sub.starter')).toBe('subscription');
    expect(config.getPlan('com.example.sub.starter')).toBe('STARTER');

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow('Product not found for nonexistent');
    expect(() => config.getPlan('nonexistent')).toThrow('Product not found for nonexistent');
  });

  describe('comparePlans', () => {
    const ladder = StripeConfig.create({
      namespace: 'com.example',
      plans: ['STARTER', 'PRO'],
      billingPeriods: ['monthly', 'yearly'],
      mode: 'live',
      allowPromotionCodes: true,
      cancellationCouponId: 'coupon_123456',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
      successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
    })
      .product('com.example.starter.monthly', 'STARTER', 'monthly')
      .price('price_sm')
      .default('price_sm')
      .product('com.example.starter.yearly', 'STARTER', 'yearly')
      .price('price_sy')
      .default('price_sy')
      .product('com.example.pro.monthly', 'PRO', 'monthly')
      .price('price_pm')
      .default('price_pm')
      .product('com.example.credits')
      .price('price_c')
      .default('price_c');

    it('ranks by plan first, whatever the periods', () => {
      expect(ladder.comparePlans('com.example.starter.yearly', 'com.example.pro.monthly')).toBe(
        'upgrade'
      );
      expect(ladder.comparePlans('com.example.pro.monthly', 'com.example.starter.yearly')).toBe(
        'downgrade'
      );
    });

    it('compares periods within one plan', () => {
      expect(ladder.comparePlans('com.example.starter.monthly', 'com.example.starter.yearly')).toBe(
        'longer'
      );
      expect(ladder.comparePlans('com.example.starter.yearly', 'com.example.starter.monthly')).toBe(
        'shorter'
      );
      expect(ladder.comparePlans('com.example.pro.monthly', 'com.example.pro.monthly')).toBe(
        'same'
      );
    });

    it('needs both products to be subscriptions', () => {
      expect(() => ladder.comparePlans('com.example.credits', 'com.example.pro.monthly')).toThrow(
        'Product com.example.credits is not a subscription'
      );
    });
  });

  it('should say whether a product is a subscription without throwing', () => {
    expect(config.isSubscription('com.example.sub.starter')).toBe(true);
    expect(config.isSubscription('com.example.sub.starter.yearly')).toBe(true);
    expect(config.isSubscription('com.example.credits.starter')).toBe(false);
    expect(config.isSubscription('nonexistent')).toBe(false);
  });

  it('should return correct billing period', () => {
    expect(config.getBillingPeriod('com.example.sub.starter')).toBe('monthly');

    // the same plan resolves to different periods by product
    expect(config.getPlan('com.example.sub.starter.yearly')).toBe('STARTER');
    expect(config.getBillingPeriod('com.example.sub.starter.yearly')).toBe('yearly');
    expect(config.getMode('com.example.sub.starter.yearly')).toBe('subscription');
    expect(config.getPriceId('com.example.sub.starter.yearly')).toBe('price_starter_yearly1');

    // one-time products have no billing period
    expect(() => config.getBillingPeriod('com.example.credits.starter')).toThrow(
      'Product com.example.credits.starter is not a subscription'
    );

    // non-existent product
    expect(() => config.getBillingPeriod('nonexistent')).toThrow(
      'Product not found for nonexistent'
    );
  });

  it('should reject duplicate declarations at runtime', () => {
    const fresh = StripeConfig.create({
      namespace: 'com.example',
      plans: PLANS,
      billingPeriods: BILLING_PERIODS,
      mode: 'live',
      allowPromotionCodes: true,
      cancellationCouponId: 'coupon_123456',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
      successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
    });
    fresh.product('com.example.sub.pro', 'STARTER', 'monthly').price('price_1').default('price_1');

    // statement-style re-entry compiles (the variable's type never accumulates) but must throw
    expect(() =>
      fresh
        .product('com.example.sub.pro2', 'STARTER', 'monthly')
        .price('price_2')
        .default('price_2')
    ).toThrow('Duplicate plan STARTER:monthly');
    expect(() => fresh.product('com.example.sub.pro').price('price_3').default('price_3')).toThrow(
      'Duplicate product com.example.sub.pro'
    );

    const chain = fresh.product('com.example.credits.x');
    chain.price('price_x1');
    expect(() => chain.price('price_x1')).toThrow('Duplicate price price_x1');

    // a price already declared on another product
    expect(() =>
      fresh.product('com.example.credits.y').price('price_1').default('price_1')
    ).toThrow('Duplicate price price_1 on com.example.sub.pro');
  });

  it('should find the product a price is declared on', () => {
    expect(config.getProductId('price_credits_500')).toBe('com.example.credits.starter');
    expect(config.getProductId('price_starter_monthly2')).toBe('com.example.sub.starter');
    // live mode: the test twin is not a declared price
    expect(config.getProductId('price_starter_yearly1_test')).toBeNull();
    expect(config.getProductId('price_unknown')).toBeNull();
  });

  it('should reject invalid configurations at the type level', () => {
    // checked by tsc, never executed
    const typeChecks = () => {
      // @ts-expect-error mode is required
      StripeConfig.create({
        namespace: 'com.example',
        plans: PLANS,
        billingPeriods: BILLING_PERIODS,
        allowPromotionCodes: true,
        cancellationCouponId: 'coupon_123456',
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel',
        successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      });
      // @ts-expect-error duplicate productId
      config.product('com.example.free');
      // @ts-expect-error plan without billingPeriod
      config.product('com.example.sub.pro', 'STARTER');
      // @ts-expect-error billingPeriod outside the caller-defined union
      config.product('com.example.sub.pro', 'STARTER', 'weekly');
      // @ts-expect-error duplicate plan+period pair must live in the existing product chain
      config.product('com.example.sub.starter2', 'STARTER', 'monthly');
      // @ts-expect-error the yearly pair is taken by com.example.sub.starter.yearly as well
      config.product('com.example.sub.starter2', 'STARTER', 'yearly');
      // (the main config chain itself proves same plan + different period compiles)
      const inferred = StripeConfig.create({
        namespace: 'io.inferred',
        plans: ['BASIC', 'PLUS'],
        billingPeriods: ['MONTHLY'],
        mode: 'live',
        allowPromotionCodes: false,
        cancellationCouponId: 'coupon_1',
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel',
        successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      });
      // namespace, plans and periods are all inferred from the options, no type arguments
      inferred.product('io.inferred.plus', 'PLUS', 'MONTHLY');
      // @ts-expect-error outside the inferred namespace
      inferred.product('com.example.plus', 'PLUS', 'MONTHLY');
      // @ts-expect-error not one of the inferred plans
      inferred.product('io.inferred.pro', 'PRO', 'MONTHLY');
      // @ts-expect-error not one of the inferred periods
      inferred.product('io.inferred.plus.yearly', 'PLUS', 'YEARLY');
      const oneTimeOnly = StripeConfig.create(options);
      // @ts-expect-error a config that sells no subscriptions has no plans to name
      oneTimeOnly.product('io.x.a', 'A', 'B');
    };
    expect(typeChecks).toBeInstanceOf(Function);
  });

  it('should check namespace, plans and periods at runtime too', () => {
    // widened on purpose, as for ids built at runtime: only the runtime checks stand
    const loose = StripeConfig.create<Lowercase<string>, string, string>({
      ...options,
      namespace: 'com.example',
      plans: PLANS,
      billingPeriods: BILLING_PERIODS,
    });
    expect(() => loose.product('io.other.credits')).toThrow(
      'Product io.other.credits is not in namespace com.example'
    );
    expect(() => loose.product('com.example.x', 'PRO', 'monthly')).toThrow(
      'Plan PRO is not in plans'
    );
    expect(() => loose.product('com.example.y', 'STARTER', 'weekly')).toThrow(
      'Billing period weekly is not in billingPeriods'
    );
    expect(() => StripeConfig.create({ ...options, plans: ['A', 'A'] })).toThrow(
      'Duplicate plan in plans'
    );
  });

  it('should return correct priceId', () => {
    expect(config.getPriceId('com.example.credits.starter')).toBe('price_credits_100');
    expect(config.getPriceId('com.example.sub.starter')).toBe('price_starter_monthly1');
    expect(config.getPriceId('com.example.free')).toBe('price_free');

    // live mode ignores the test twin entirely: not the default, not a known price
    expect(config.mode).toBe('live');
    expect(config.getPriceId('com.example.sub.starter.yearly')).toBe('price_starter_yearly1');
    expect(() =>
      config.getCreditAmount('com.example.sub.starter.yearly', 'price_starter_yearly1_test')
    ).toThrow('Price not found for price_starter_yearly1_test');

    expect(() => config.getPriceId('nonexistent')).toThrow('Product not found for nonexistent');
  });

  it('should return correct credit amount', () => {
    // default price
    expect(config.getCreditAmount('com.example.credits.starter')).toBe(100);
    expect(config.getCreditAmount('com.example.sub.starter')).toBe(1000);
    expect(config.getCreditAmount('com.example.free')).toBe(0);

    // specific price
    expect(config.getCreditAmount('com.example.credits.starter', 'price_credits_500')).toBe(500);
    expect(config.getCreditAmount('com.example.sub.starter', 'price_starter_monthly2')).toBe(12000);

    // errors
    expect(() => config.getCreditAmount('nonexistent')).toThrow(
      'Product not found for nonexistent'
    );
    expect(() => config.getCreditAmount('com.example.credits.starter', 'price_invalid')).toThrow(
      'Price not found for price_invalid'
    );
  });

  it('should return correct credit expiration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    // default price (30d)
    expect(config.getCreditExpiresAt('com.example.credits.starter')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.starter')).toBe('2025-01-31T00:00:00.000Z');

    // specific price (60d / 365d)
    expect(config.getCreditExpiresAt('com.example.credits.starter', 'price_credits_500')).toBe(
      '2025-03-02T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.starter', 'price_starter_monthly2')).toBe(
      '2026-01-01T00:00:00.000Z'
    );

    // errors
    expect(() => config.getCreditExpiresAt('nonexistent')).toThrow(
      'Product not found for nonexistent'
    );
    expect(() => config.getCreditExpiresAt('com.example.credits.starter', 'price_invalid')).toThrow(
      'Price not found for price_invalid'
    );

    vi.useRealTimers();
  });

  describe('test mode', () => {
    const create = () =>
      StripeConfig.create({
        namespace: 'com.example',
        plans: PLANS,
        billingPeriods: BILLING_PERIODS,
        mode: 'test',
        allowPromotionCodes: true,
        cancellationCouponId: 'coupon_123456',
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel',
        successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      });

    const sandbox = create()
      .product('com.example.credits.starter')
      .price('price_credits_100', { credits: 100, expiresIn: '30d' })
      .price('price_credits_500', { credits: 500, expiresIn: '60d' })
      .default('price_credits_100', { test: 'price_credits_100_test' })
      .product('com.example.sub.starter', 'STARTER', 'monthly')
      .price('price_starter_monthly1', { credits: 1000, expiresIn: '30d' })
      .default('price_starter_monthly1', { test: 'price_starter_monthly1_test' });

    it('should create checkouts with the test twin', () => {
      expect(sandbox.mode).toBe('test');
      expect(sandbox.getPriceId('com.example.credits.starter')).toBe('price_credits_100_test');
      expect(sandbox.getPriceId('com.example.sub.starter')).toBe('price_starter_monthly1_test');
    });

    it('should find the product of a test twin', () => {
      expect(sandbox.getProductId('price_starter_monthly1_test')).toBe('com.example.sub.starter');
      expect(sandbox.getProductId('price_starter_monthly1')).toBe('com.example.sub.starter');
    });

    it('should resolve the twin to the default price entitlement', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

      // by explicit price id, as webhook handlers do
      expect(sandbox.getCreditAmount('com.example.credits.starter', 'price_credits_100_test')).toBe(
        100
      );
      expect(
        sandbox.getCreditExpiresAt('com.example.credits.starter', 'price_credits_100_test')
      ).toBe('2025-01-31T00:00:00.000Z');
      // by default
      expect(sandbox.getCreditAmount('com.example.sub.starter')).toBe(1000);
      expect(sandbox.getCreditExpiresAt('com.example.sub.starter')).toBe(
        '2025-01-31T00:00:00.000Z'
      );
      // the live ids stay declared and resolvable
      expect(sandbox.getCreditAmount('com.example.credits.starter', 'price_credits_100')).toBe(100);
      expect(sandbox.getCreditAmount('com.example.credits.starter', 'price_credits_500')).toBe(500);

      vi.useRealTimers();
    });

    it('should require a test twin on every default', () => {
      expect(() =>
        create().product('com.example.credits.x').price('price_x1').default('price_x1')
      ).toThrow('Test price not declared for default price_x1 of com.example.credits.x');
    });

    it('should reject a twin that collides with a declared price', () => {
      expect(() =>
        create()
          .product('com.example.credits.x')
          .price('price_x1')
          .price('price_x2')
          .default('price_x1', { test: 'price_x2' })
      ).toThrow('Duplicate price price_x2');
    });
  });
});
