import { describe, expect, it, vi } from 'vitest';
import { StripeConfig } from '../config';

describe('StripeConfig', () => {
  const config = StripeConfig.create({
    allowPromotionCodes: true,
    returnUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
    successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
  })
    // One-time payment product with multiple prices
    .product('credits')
    .price('price_credits_100', { credits: 100, expiresIn: '30d' })
    .price('price_credits_500', { credits: 500, expiresIn: '60d' })
    .default('price_credits_100')
    // Subscription product
    .product('pro', 'plan_pro')
    .price('price_pro_monthly', { credits: 1000, expiresIn: '30d' })
    .price('price_pro_yearly', { credits: 12000, expiresIn: '365d' })
    .default('price_pro_monthly')
    // Free tier (no credits)
    .product('free')
    .price('price_free')
    .default('price_free');

  it('should manage products correctly', () => {
    expect(config.productIds).toHaveLength(3);
    expect(config.productIds).toContain('credits');
    expect(config.productIds).toContain('pro');
    expect(config.productIds).toContain('free');
  });

  it('should return correct mode and plan', () => {
    // payment mode (no plan)
    expect(config.getMode('credits')).toBe('payment');
    expect(config.getMode('free')).toBe('payment');
    expect(() => config.getPlan('credits')).toThrow('Plan not found for product credits');

    // subscription mode (has plan)
    expect(config.getMode('pro')).toBe('subscription');
    expect(config.getPlan('pro')).toBe('plan_pro');

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow();
    expect(() => config.getPlan('nonexistent')).toThrow();
  });

  it('should return correct priceId', () => {
    expect(config.getPriceId('credits')).toBe('price_credits_100');
    expect(config.getPriceId('pro')).toBe('price_pro_monthly');
    expect(config.getPriceId('free')).toBe('price_free');

    expect(() => config.getPriceId('nonexistent')).toThrow();
  });

  it('should return correct credit amount', () => {
    // default price
    expect(config.getCreditAmount('credits')).toBe(100);
    expect(config.getCreditAmount('pro')).toBe(1000);
    expect(config.getCreditAmount('free')).toBe(0);

    // specific price
    expect(config.getCreditAmount('credits', 'price_credits_500')).toBe(500);
    expect(config.getCreditAmount('pro', 'price_pro_yearly')).toBe(12000);

    // errors
    expect(() => config.getCreditAmount('nonexistent')).toThrow();
    expect(() => config.getCreditAmount('credits', 'price_invalid')).toThrow();
  });

  it('should return correct credit expiration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    // default price (30d)
    expect(config.getCreditExpiresAt('credits')).toBe('2025-01-31T00:00:00.000Z');
    expect(config.getCreditExpiresAt('pro')).toBe('2025-01-31T00:00:00.000Z');

    // specific price (60d / 365d)
    expect(config.getCreditExpiresAt('credits', 'price_credits_500')).toBe(
      '2025-03-02T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('pro', 'price_pro_yearly')).toBe('2026-01-01T00:00:00.000Z');

    // errors
    expect(() => config.getCreditExpiresAt('nonexistent')).toThrow();
    expect(() => config.getCreditExpiresAt('credits', 'price_invalid')).toThrow();

    vi.useRealTimers();
  });
});
