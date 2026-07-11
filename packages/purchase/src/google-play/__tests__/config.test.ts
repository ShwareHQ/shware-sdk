import { describe, expect, it, vi } from 'vitest';
import { GooglePlayConfig } from '../config';

describe('GooglePlayConfig', () => {
  const Plan = {
    STARTER: 'STARTER',
    PREMIUM: 'PREMIUM',
  } as const;
  type Plan = (typeof Plan)[keyof typeof Plan];

  type BillingPeriod = 'monthly' | 'yearly';

  const config = GooglePlayConfig.create<'com.example', Plan, BillingPeriod>({
    package: 'com.example.app',
    audience: 'com.example.api',
  })
    .subscription('com.example.sub.starter')
    .basePlan('monthly_v1', Plan.STARTER, 'monthly', { credits: 100, expiresIn: '30d' })
    // versioned base plan sharing the same plan+period
    .basePlan('monthly_v2', Plan.STARTER, 'monthly', { credits: 150, expiresIn: '30d' })
    .basePlan('yearly_v1', Plan.STARTER, 'yearly', { credits: 200, expiresIn: '365d' })
    .default(['monthly_v2', 'yearly_v1'])
    .subscription('com.example.sub.premium')
    .basePlan('monthly_v1', Plan.PREMIUM, 'monthly', { credits: 300, expiresIn: '30d' })
    .basePlan('yearly_v1', Plan.PREMIUM, 'yearly', { credits: 400, expiresIn: '365d' })
    .default(['monthly_v1', 'yearly_v1'])
    .onetime('com.example.credit.starter', { credits: 100, expiresIn: '30d' })
    .onetime('com.example.credit.premium', { credits: 200, expiresIn: '60d' });

  it('should return correct mode', () => {
    // subscription products
    expect(config.getMode('com.example.sub.starter')).toBe('subscription');
    expect(config.getMode('com.example.sub.premium')).toBe('subscription');

    // onetime products (payment mode)
    expect(config.getMode('com.example.credit.starter')).toBe('payment');
    expect(config.getMode('com.example.credit.premium')).toBe('payment');

    // non-existent product
    expect(() => config.getMode('nonexistent')).toThrow();
  });

  it('should return correct plan', () => {
    // subscription products with basePlan
    expect(config.getPlan('com.example.sub.starter', 'monthly_v1')).toBe(Plan.STARTER);
    expect(config.getPlan('com.example.sub.starter', 'yearly_v1')).toBe(Plan.STARTER);
    expect(config.getPlan('com.example.sub.premium', 'monthly_v1')).toBe(Plan.PREMIUM);
    expect(config.getPlan('com.example.sub.premium', 'yearly_v1')).toBe(Plan.PREMIUM);

    // non-existent
    expect(() => config.getPlan('nonexistent', 'monthly_v1')).toThrow();
    expect(() => config.getPlan('com.example.sub.starter', 'nonexistent')).toThrow();
  });

  it('should return correct billing period', () => {
    expect(config.getBillingPeriod('com.example.sub.starter', 'monthly_v1')).toBe('monthly');
    expect(config.getBillingPeriod('com.example.sub.starter', 'yearly_v1')).toBe('yearly');

    // versioned base plans share the same plan+period but keep their own metadata
    expect(config.getBillingPeriod('com.example.sub.starter', 'monthly_v2')).toBe('monthly');
    expect(config.getPlan('com.example.sub.starter', 'monthly_v2')).toBe(Plan.STARTER);
    expect(config.getCreditAmount('com.example.sub.starter', 'monthly_v2')).toBe(150);
    expect(config.getBillingPeriod('com.example.sub.premium', 'monthly_v1')).toBe('monthly');
    expect(config.getBillingPeriod('com.example.sub.premium', 'yearly_v1')).toBe('yearly');

    // onetime products have no billing period
    expect(() => config.getBillingPeriod('com.example.credit.starter', 'monthly_v1')).toThrow();

    // non-existent
    expect(() => config.getBillingPeriod('nonexistent', 'monthly_v1')).toThrow();
    expect(() => config.getBillingPeriod('com.example.sub.starter', 'nonexistent')).toThrow();
  });

  it('should return default base plan ids', () => {
    expect(config.getDefaultPlanIds('com.example.sub.starter')).toEqual([
      'monthly_v2',
      'yearly_v1',
    ]);
    expect(config.getDefaultPlanIds('com.example.sub.premium')).toEqual([
      'monthly_v1',
      'yearly_v1',
    ]);

    expect(() => config.getDefaultPlanIds('com.example.credit.starter')).toThrow(
      'Subscription not found for com.example.credit.starter'
    );
    expect(() => config.getDefaultPlanIds('nonexistent')).toThrow();
  });

  it('should reject duplicate declarations at runtime', () => {
    const fresh = GooglePlayConfig.create<'com.example', Plan, BillingPeriod>({
      package: 'com.example.app',
      audience: 'com.example.api',
    });
    fresh
      .subscription('com.example.sub.pro')
      .basePlan('monthly_v1', Plan.PREMIUM, 'monthly')
      .default(['monthly_v1']);

    // statement-style re-entry compiles (the variable's type never accumulates) but must throw
    expect(() =>
      fresh
        .subscription('com.example.sub.pro')
        .basePlan('monthly_v2', Plan.PREMIUM, 'monthly')
        .default(['monthly_v2'])
    ).toThrow('Duplicate subscription com.example.sub.pro');

    const chain = fresh.subscription('com.example.sub.max');
    chain.basePlan('monthly_v1', Plan.PREMIUM, 'monthly');
    expect(() => chain.basePlan('monthly_v1', Plan.PREMIUM, 'monthly')).toThrow(
      'Duplicate base plan monthly_v1'
    );
    expect(() => chain.default(['undeclared_v1'] as never)).toThrow(
      'Default base plan undeclared_v1 is not declared'
    );

    fresh.onetime('com.example.credit.x');
    expect(() => fresh.onetime('com.example.credit.x')).toThrow(
      'Duplicate product com.example.credit.x'
    );
  });

  it('should reject invalid configurations at the type level', () => {
    // checked by tsc, never executed
    const typeChecks = () => {
      // @ts-expect-error duplicate productId
      config.onetime('com.example.credit.starter');
      // @ts-expect-error productId outside the namespace
      config.onetime('org.other.credit.starter');

      const chain = config
        .subscription('com.example.sub.pro')
        .basePlan('monthly_v1', Plan.PREMIUM, 'monthly');
      // same plan+period on another basePlan version is allowed (google play versioning)
      chain.basePlan('monthly_v2', Plan.PREMIUM, 'monthly');
      // @ts-expect-error duplicate planId within the subscription
      chain.basePlan('monthly_v1', Plan.PREMIUM, 'monthly');
      // @ts-expect-error billing period outside the caller-defined union
      chain.basePlan('monthly_v3', Plan.PREMIUM, 'weekly');
      // @ts-expect-error default may only reference declared planIds
      chain.default(['nonexistent_v1']);
      // @ts-expect-error default planIds must be unique
      chain.default(['monthly_v1', 'monthly_v1']);
      chain.default(['monthly_v1']);

      // full valid chain: versioned base plans sharing a plan+period, both as defaults
      config
        .subscription('com.example.sub.max')
        .basePlan('monthly_v1', Plan.PREMIUM, 'monthly')
        .basePlan('monthly_v2', Plan.PREMIUM, 'monthly')
        .default(['monthly_v1', 'monthly_v2']);
    };
    expect(typeChecks).toBeInstanceOf(Function);
  });

  it('should return correct credit amount', () => {
    // Subscription products
    expect(config.getCreditAmount('com.example.sub.starter', 'monthly_v1')).toBe(100);
    expect(config.getCreditAmount('com.example.sub.starter', 'yearly_v1')).toBe(200);
    expect(config.getCreditAmount('com.example.sub.premium', 'monthly_v1')).toBe(300);
    expect(config.getCreditAmount('com.example.sub.premium', 'yearly_v1')).toBe(400);

    // Onetime products
    expect(config.getCreditAmount('com.example.credit.starter')).toBe(100);
    expect(config.getCreditAmount('com.example.credit.premium')).toBe(200);

    // non-existent
    expect(() => config.getCreditAmount('nonexistent', 'monthly_v1')).toThrow();
    expect(() => config.getCreditAmount('com.example.sub.starter', 'nonexistent')).toThrow();
    expect(() => config.getCreditAmount('nonexistent')).toThrow();
  });

  it('should return correct credit expiration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    expect(config.getCreditExpiresAt('com.example.sub.starter', 'monthly_v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.starter', 'yearly_v1')).toBe(
      '2026-01-01T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.premium', 'monthly_v1')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.sub.premium', 'yearly_v1')).toBe(
      '2026-01-01T00:00:00.000Z'
    );

    // onetime products
    expect(config.getCreditExpiresAt('com.example.credit.starter')).toBe(
      '2025-01-31T00:00:00.000Z'
    );
    expect(config.getCreditExpiresAt('com.example.credit.premium')).toBe(
      '2025-03-02T00:00:00.000Z'
    );

    // non-existent product
    expect(() => config.getCreditExpiresAt('nonexistent', 'monthly_v1')).toThrow();
    expect(() => config.getCreditExpiresAt('com.example.sub.starter', 'nonexistent')).toThrow();
    expect(() => config.getCreditExpiresAt('nonexistent')).toThrow();

    vi.useRealTimers();
  });
});
