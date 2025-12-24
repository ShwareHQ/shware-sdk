import { describe, expect, it, vi } from 'vitest';
import { GooglePlayConfig } from '../config';

describe('GooglePlayConfig', () => {
  enum Plan {
    STARTER_MONTHLY = 'STARTER_MONTHLY',
    STARTER_YEARLY = 'STARTER_YEARLY',
    PREMIUM_MONTHLY = 'PREMIUM_MONTHLY',
    PREMIUM_YEARLY = 'PREMIUM_YEARLY',
  }

  const config = GooglePlayConfig.create<'com.example', Plan>({
    package: 'com.example.app',
    audience: 'com.example.api',
  })
    .subscription('com.example.sub.starter')
    .basePlan('monthly_v1', Plan.STARTER_MONTHLY, { credits: 100, expiresIn: '30d' })
    .basePlan('yearly_v1', Plan.STARTER_YEARLY, { credits: 200, expiresIn: '365d' })
    .default(['monthly_v1', 'yearly_v1'])
    .subscription('com.example.sub.premium')
    .basePlan('monthly_v1', Plan.PREMIUM_MONTHLY, { credits: 300, expiresIn: '30d' })
    .basePlan('yearly_v1', Plan.PREMIUM_YEARLY, { credits: 400, expiresIn: '365d' })
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
    expect(config.getPlan('com.example.sub.starter', 'monthly_v1')).toBe(Plan.STARTER_MONTHLY);
    expect(config.getPlan('com.example.sub.starter', 'yearly_v1')).toBe(Plan.STARTER_YEARLY);
    expect(config.getPlan('com.example.sub.premium', 'monthly_v1')).toBe(Plan.PREMIUM_MONTHLY);
    expect(config.getPlan('com.example.sub.premium', 'yearly_v1')).toBe(Plan.PREMIUM_YEARLY);

    // non-existent
    expect(() => config.getPlan('nonexistent', 'monthly_v1')).toThrow();
    expect(() => config.getPlan('com.example.sub.starter', 'nonexistent')).toThrow();
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
