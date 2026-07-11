import { describe, expect, it, vi } from 'vitest';
import { AppStoreConfig } from '../config';

describe('AppStoreConfig', () => {
  enum Plan {
    STARTER = 'STARTER',
    PRO = 'PRO',
    PREMIUM = 'PREMIUM',
  }

  type BillingPeriod = 'monthly' | 'yearly';

  const config = AppStoreConfig.create<'com.example', Plan, BillingPeriod>({
    appId: '123456',
    bundleId: 'com.example.app',
  })
    .subscription(Plan.STARTER, 'monthly')
    .product('com.example.sub.starter.v1', { credits: 100, expiresIn: '30d' })
    .product('com.example.sub.starter.v2', { credits: 200, expiresIn: '30d' })
    .default('com.example.sub.starter.v2')
    // same plan, different billing period
    .subscription(Plan.STARTER, 'yearly')
    .product('com.example.sub.starter.yearly.v1', { credits: 1200, expiresIn: '365d' })
    .default('com.example.sub.starter.yearly.v1')
    .subscription(Plan.PRO, 'monthly')
    .product('com.example.sub.pro.v1', { credits: 300, expiresIn: '60d' })
    .product('com.example.sub.pro.v2', { credits: 400, expiresIn: '60d' })
    .default('com.example.sub.pro.v2')
    .subscription(Plan.PREMIUM, 'monthly')
    .product('com.example.sub.premium.v1', { credits: 500, expiresIn: '90d' })
    .product('com.example.sub.premium.v2', { credits: 600, expiresIn: '90d' })
    .default('com.example.sub.premium.v2')
    // one-time products
    .consumable('com.example.credits.starter.v1', { credits: 100, expiresIn: '30d' })
    .consumable('com.example.credits.pro.v1', { credits: 200, expiresIn: '30d' })
    .consumable('com.example.credits.premium.v1', { credits: 300, expiresIn: '30d' })
    // lifetime products
    .nonConsumable('com.example.role-skin.red')
    .nonConsumable('com.example.role-skin.green')
    .nonConsumable('com.example.role-skin.blue');

  it('should return correct mode', () => {
    // subscription products
    expect(config.getMode('com.example.sub.starter.v1')).toBe('subscription');
    expect(config.getMode('com.example.sub.starter.v2')).toBe('subscription');
    expect(config.getMode('com.example.sub.pro.v1')).toBe('subscription');
    expect(config.getMode('com.example.sub.pro.v2')).toBe('subscription');
    expect(config.getMode('com.example.sub.premium.v1')).toBe('subscription');
    expect(config.getMode('com.example.sub.premium.v2')).toBe('subscription');

    // consumable products (payment mode)
    expect(config.getMode('com.example.credits.starter.v1')).toBe('payment');
    expect(config.getMode('com.example.credits.pro.v1')).toBe('payment');
    expect(config.getMode('com.example.credits.premium.v1')).toBe('payment');

    // non-consumable products (payment mode)
    expect(config.getMode('com.example.role-skin.red')).toBe('payment');
    expect(config.getMode('com.example.role-skin.green')).toBe('payment');
    expect(config.getMode('com.example.role-skin.blue')).toBe('payment');

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow();
  });

  it('should return correct plan', () => {
    // subscription products
    expect(config.getPlan('com.example.sub.starter.v1')).toBe(Plan.STARTER);
    expect(config.getPlan('com.example.sub.starter.v2')).toBe(Plan.STARTER);
    expect(config.getPlan('com.example.sub.starter.yearly.v1')).toBe(Plan.STARTER);
    expect(config.getPlan('com.example.sub.pro.v1')).toBe(Plan.PRO);
    expect(config.getPlan('com.example.sub.pro.v2')).toBe(Plan.PRO);
    expect(config.getPlan('com.example.sub.premium.v1')).toBe(Plan.PREMIUM);
    expect(config.getPlan('com.example.sub.premium.v2')).toBe(Plan.PREMIUM);

    // consumable products (should throw because they have no plan)
    expect(() => config.getPlan('com.example.credits.starter.v1')).toThrow();
    expect(() => config.getPlan('com.example.credits.pro.v1')).toThrow();
    expect(() => config.getPlan('com.example.credits.premium.v1')).toThrow();

    // non-consumable products (should throw because they have no plan)
    expect(() => config.getPlan('com.example.role-skin.red')).toThrow();
    expect(() => config.getPlan('com.example.role-skin.green')).toThrow();
    expect(() => config.getPlan('com.example.role-skin.blue')).toThrow();

    // non-existent product
    expect(() => config.getPlan('nonexistent')).toThrow();
  });

  it('should return correct billing period', () => {
    // the same plan resolves to different periods by product
    expect(config.getBillingPeriod('com.example.sub.starter.v1')).toBe('monthly');
    expect(config.getBillingPeriod('com.example.sub.starter.v2')).toBe('monthly');
    expect(config.getBillingPeriod('com.example.sub.starter.yearly.v1')).toBe('yearly');
    expect(config.getBillingPeriod('com.example.sub.premium.v1')).toBe('monthly');

    // one-time products have no billing period
    expect(() => config.getBillingPeriod('com.example.credits.starter.v1')).toThrow(
      'Billing period not found for product com.example.credits.starter.v1'
    );
    expect(() => config.getBillingPeriod('com.example.role-skin.red')).toThrow();

    // non-existent product
    expect(() => config.getBillingPeriod('nonexistent')).toThrow();
  });

  it('should reject invalid configurations at the type level', () => {
    // checked by tsc, never executed
    const typeChecks = () => {
      // @ts-expect-error duplicate plan+period pair must live in the existing subscription chain
      config.subscription(Plan.STARTER, 'monthly');
      // @ts-expect-error billing period is required
      config.subscription(Plan.PRO);
      // @ts-expect-error billing period outside the caller-defined union
      config.subscription(Plan.PRO, 'weekly');
      // @ts-expect-error plan outside the caller-defined enum
      config.subscription('ENTERPRISE', 'monthly');
      // @ts-expect-error duplicate productId
      config.consumable('com.example.credits.starter.v1');
      // @ts-expect-error productId outside the namespace
      config.consumable('org.other.credits.starter');
      // @ts-expect-error uppercase productId is not allowed
      config.nonConsumable('com.example.ROLE-SKIN.red');
      // same plan with a different period is allowed
      config.subscription(Plan.PRO, 'yearly');

      const chain = config
        .subscription(Plan.PREMIUM, 'yearly')
        .product('com.example.sub.premium.yearly.v1');
      // @ts-expect-error duplicate productId within the chain
      chain.product('com.example.sub.premium.yearly.v1');
      // @ts-expect-error default must be one of the declared products
      chain.default('com.example.sub.premium.yearly.v9');
      chain.default('com.example.sub.premium.yearly.v1');
    };
    expect(typeChecks).toBeInstanceOf(Function);
  });

  it('should manage products correctly', () => {
    expect(config.productIds).toHaveLength(13);
    // subscription products
    expect(config.productIds).toContain('com.example.sub.starter.v1');
    expect(config.productIds).toContain('com.example.sub.starter.v2');
    expect(config.productIds).toContain('com.example.sub.starter.yearly.v1');
    expect(config.productIds).toContain('com.example.sub.pro.v1');
    expect(config.productIds).toContain('com.example.sub.pro.v2');
    expect(config.productIds).toContain('com.example.sub.premium.v1');
    expect(config.productIds).toContain('com.example.sub.premium.v2');
    // consumable products
    expect(config.productIds).toContain('com.example.credits.starter.v1');
    expect(config.productIds).toContain('com.example.credits.pro.v1');
    expect(config.productIds).toContain('com.example.credits.premium.v1');
    // non-consumable products
    expect(config.productIds).toContain('com.example.role-skin.red');
    expect(config.productIds).toContain('com.example.role-skin.green');
    expect(config.productIds).toContain('com.example.role-skin.blue');
  });

  it('should return correct credit amount', () => {
    // MONTHLY_STARTER products
    expect(config.getCreditAmount('com.example.sub.starter.v1')).toBe(100);
    expect(config.getCreditAmount('com.example.sub.starter.v2')).toBe(200);

    // MONTHLY_PRO products
    expect(config.getCreditAmount('com.example.sub.pro.v1')).toBe(300);
    expect(config.getCreditAmount('com.example.sub.pro.v2')).toBe(400);

    // MONTHLY_PREMIUM products
    expect(config.getCreditAmount('com.example.sub.premium.v1')).toBe(500);
    expect(config.getCreditAmount('com.example.sub.premium.v2')).toBe(600);

    // consumable products
    expect(config.getCreditAmount('com.example.credits.starter.v1')).toBe(100);
    expect(config.getCreditAmount('com.example.credits.pro.v1')).toBe(200);
    expect(config.getCreditAmount('com.example.credits.premium.v1')).toBe(300);

    // non-consumable products (should throw because they have no credit config)
    expect(() => config.getCreditAmount('com.example.role-skin.red')).toThrow();
    expect(() => config.getCreditAmount('com.example.role-skin.green')).toThrow();
    expect(() => config.getCreditAmount('com.example.role-skin.blue')).toThrow();

    // non-existent product
    expect(() => config.getCreditAmount('nonexistent')).toThrow();
  });

  it('should return correct credit expiration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    // MONTHLY_STARTER (30d)
    expect(config.getCreditExpiresAt('com.example.sub.starter.v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.starter.v2')).toBe(
      '2025-01-31T00:00:00.000Z'
    );

    // MONTHLY_PRO (60d)
    expect(config.getCreditExpiresAt('com.example.sub.pro.v1')).toBe('2025-03-02T00:00:00.000Z');
    expect(config.getCreditExpiresAt('com.example.sub.pro.v2')).toBe('2025-03-02T00:00:00.000Z');

    // MONTHLY_PREMIUM (90d)
    expect(config.getCreditExpiresAt('com.example.sub.premium.v1')).toBe(
      '2025-04-01T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.premium.v2')).toBe(
      '2025-04-01T00:00:00.000Z'
    );

    // consumable products (30d)
    expect(config.getCreditExpiresAt('com.example.credits.starter.v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.credits.pro.v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.credits.premium.v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );

    // non-consumable products (should throw because they have no credit config)
    expect(() => config.getCreditExpiresAt('com.example.role-skin.red')).toThrow();
    expect(() => config.getCreditExpiresAt('com.example.role-skin.green')).toThrow();
    expect(() => config.getCreditExpiresAt('com.example.role-skin.blue')).toThrow();

    // non-existent product
    expect(() => config.getCreditExpiresAt('nonexistent')).toThrow();

    vi.useRealTimers();
  });
});
