import { describe, expect, it, vi } from 'vitest';
import { StripeConfig } from '../config';

describe('StripeConfig', () => {
  enum Plan {
    STARTER = 'STARTER',
  }

  const config = StripeConfig.create<'com.example', Plan>({
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
    .product('com.example.sub.starter', Plan.STARTER)
    .price('price_starter_monthly1', { credits: 1000, expiresIn: '30d' })
    .price('price_starter_monthly2', { credits: 12000, expiresIn: '365d' })
    .default('price_starter_monthly1')
    // Free tier (no credits)
    .product('com.example.free')
    .price('price_free')
    .default('price_free');

  it('should manage products correctly', () => {
    expect(config.productIds).toHaveLength(3);
    expect(config.productIds).toContain('com.example.credits.starter');
    expect(config.productIds).toContain('com.example.sub.starter');
    expect(config.productIds).toContain('com.example.free');
  });

  it('should return correct mode and plan', () => {
    // payment mode (no plan)
    expect(config.getMode('com.example.credits.starter')).toBe('payment');
    expect(config.getMode('com.example.free')).toBe('payment');
    expect(() => config.getPlan('com.example.credits.starter')).toThrow(
      'Plan not found for product com.example.credits.starter'
    );

    // subscription mode (has plan)
    expect(config.getMode('com.example.sub.starter')).toBe('subscription');
    expect(config.getPlan('com.example.sub.starter')).toBe(Plan.STARTER);

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow();
    expect(() => config.getPlan('nonexistent')).toThrow();
  });

  it('should return correct priceId', () => {
    expect(config.getPriceId('com.example.credits.starter')).toBe('price_credits_100');
    expect(config.getPriceId('com.example.sub.starter')).toBe('price_starter_monthly1');
    expect(config.getPriceId('com.example.free')).toBe('price_free');

    expect(() => config.getPriceId('nonexistent')).toThrow();
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
    expect(() => config.getCreditAmount('nonexistent')).toThrow();
    expect(() => config.getCreditAmount('com.example.credits.starter', 'price_invalid')).toThrow();
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
    expect(() => config.getCreditExpiresAt('nonexistent')).toThrow();
    expect(() =>
      config.getCreditExpiresAt('com.example.credits.starter', 'price_invalid')
    ).toThrow();

    vi.useRealTimers();
  });
});
