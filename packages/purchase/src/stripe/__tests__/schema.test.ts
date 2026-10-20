import { describe, expect, it } from 'vitest';
import { createCheckoutSessionSchema, returnUrlSchema } from '../schema';

describe('returnUrlSchema origins', () => {
  const schema = returnUrlSchema(['https://example.com']);

  it.each([
    'https://example.com',
    'https://example.com/',
    'https://example.com/billing?session_id={CHECKOUT_SESSION_ID}',
    'https://example.com:443/pricing#plans',
  ])('allows %s', (value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each([
    'http://example.com/billing',
    'https://example.com.evil.com/billing',
    'https://evil.com/https://example.com',
    'https://example.com@evil.com/billing',
    'https://user:pass@example.com/billing',
    'https://sub.example.com/billing',
    'https://example.com:8443/billing',
    '//evil.com/billing',
    '/billing',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('allows http when the origin is http', () => {
    const local = returnUrlSchema(['http://localhost:3000']);
    expect(local.safeParse('http://localhost:3000/billing').success).toBe(true);
  });
});

describe('returnUrlSchema', () => {
  it('normalizes the allowed origins', () => {
    const schema = returnUrlSchema(['https://example.com/some/path']);
    expect(schema.safeParse('https://example.com/billing').success).toBe(true);
  });

  it.each([[[]], [['not a url']], [['javascript:alert(1)']], [['ftp://example.com']]])(
    'throws on a misconfigured list %j',
    (origins) => {
      expect(() => returnUrlSchema(origins)).toThrow(/returnUrl:|Invalid URL/);
    }
  );
});

describe('createCheckoutSessionSchema', () => {
  const schema = createCheckoutSessionSchema(['com.example.pro'], {
    allowedOrigins: ['https://example.com'],
  });

  it('accepts return URLs on an allowed origin', () => {
    const result = schema.safeParse({
      productId: 'com.example.pro',
      cancelUrl: 'https://example.com/pricing',
      successUrl: 'https://example.com/billing?session_id={CHECKOUT_SESSION_ID}',
    });
    expect(result.success).toBe(true);
    expect(result.data?.quantity).toBe(1);
  });

  it('accepts a body without return URLs', () => {
    expect(schema.safeParse({ productId: 'com.example.pro' }).success).toBe(true);
  });

  it.each(['cancelUrl', 'successUrl'])('refuses %s on another origin', (field) => {
    const result = schema.safeParse({ productId: 'com.example.pro', [field]: 'https://evil.com' });
    expect(result.success).toBe(false);
  });
});
