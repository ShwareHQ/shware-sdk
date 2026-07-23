import { describe, expect, it, vi } from 'vitest';
import { StripeConfig } from '../config';

describe('StripeConfig', () => {
  const Plan = {
    STARTER: 'STARTER',
  } as const;
  type Plan = (typeof Plan)[keyof typeof Plan];

  type BillingPeriod = 'monthly' | 'yearly';

  const config = StripeConfig.create<'com.example', Plan, BillingPeriod>({
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
    .product('com.example.sub.starter', Plan.STARTER, 'monthly')
    .price('price_starter_monthly1', { credits: 1000, expiresIn: '30d' })
    .price('price_starter_monthly2', { credits: 12000, expiresIn: '365d' })
    .default('price_starter_monthly1')
    // Same plan, different billing period
    .product('com.example.sub.starter.yearly', Plan.STARTER, 'yearly')
    .price('price_starter_yearly1', { credits: 12000, expiresIn: '365d' })
    .default('price_starter_yearly1')
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
    expect(config.getPlan('com.example.sub.starter')).toBe(Plan.STARTER);

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow('Product not found for nonexistent');
    expect(() => config.getPlan('nonexistent')).toThrow('Product not found for nonexistent');
  });

  it('should return correct billing period', () => {
    expect(config.getBillingPeriod('com.example.sub.starter')).toBe('monthly');

    // the same plan resolves to different periods by product
    expect(config.getPlan('com.example.sub.starter.yearly')).toBe(Plan.STARTER);
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
    const fresh = StripeConfig.create<'com.example', Plan, BillingPeriod>({
      allowPromotionCodes: true,
      cancellationCouponId: 'coupon_123456',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
      successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
    });
    fresh
      .product('com.example.sub.pro', Plan.STARTER, 'monthly')
      .price('price_1')
      .default('price_1');

    // statement-style re-entry compiles (the variable's type never accumulates) but must throw
    expect(() =>
      fresh
        .product('com.example.sub.pro2', Plan.STARTER, 'monthly')
        .price('price_2')
        .default('price_2')
    ).toThrow('Duplicate plan STARTER:monthly');
    expect(() => fresh.product('com.example.sub.pro').price('price_3').default('price_3')).toThrow(
      'Duplicate product com.example.sub.pro'
    );

    const chain = fresh.product('com.example.credits.x');
    chain.price('price_x1');
    expect(() => chain.price('price_x1')).toThrow('Duplicate price price_x1');
  });

  it('should reject invalid configurations at the type level', () => {
    // checked by tsc, never executed
    const typeChecks = () => {
      // @ts-expect-error duplicate productId
      config.product('com.example.free');
      // @ts-expect-error plan without billingPeriod
      config.product('com.example.sub.pro', Plan.STARTER);
      // @ts-expect-error billingPeriod outside the caller-defined union
      config.product('com.example.sub.pro', Plan.STARTER, 'weekly');
      // @ts-expect-error duplicate plan+period pair must live in the existing product chain
      config.product('com.example.sub.starter2', Plan.STARTER, 'monthly');
      // @ts-expect-error the yearly pair is taken by com.example.sub.starter.yearly as well
      config.product('com.example.sub.starter2', Plan.STARTER, 'yearly');
      // (the main config chain itself proves same plan + different period compiles)
    };
    expect(typeChecks).toBeInstanceOf(Function);
  });

  it('should return correct priceId', () => {
    expect(config.getPriceId('com.example.credits.starter')).toBe('price_credits_100');
    expect(config.getPriceId('com.example.sub.starter')).toBe('price_starter_monthly1');
    expect(config.getPriceId('com.example.free')).toBe('price_free');

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
});
