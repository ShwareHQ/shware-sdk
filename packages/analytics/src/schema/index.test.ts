import { describe, expect, it } from 'vitest';
import {
  createLinkSchema,
  createTrackEventSchema,
  propertiesSchema,
  tagsSchema,
  userProvidedDataSchema,
} from './index';

/**
 * These schemas drop and truncate silently, by design — nothing downstream can tell that a value
 * was shortened or a property left behind, so nothing else would notice if the policy changed.
 */
describe('propertiesSchema', () => {
  const parse = (properties: unknown) =>
    propertiesSchema.parse(properties) as Record<string, unknown>;

  it('truncates an oversized value and leaves the rest of the event alone', () => {
    const parsed = parse({ long: 'a'.repeat(600), value: 42, ok: true });
    expect(parsed.long).toHaveLength(512);
    expect(parsed).toMatchObject({ value: 42, ok: true });
  });

  it('drops an unusable key, trims the usable ones', () => {
    expect(parse({ ['k'.repeat(129)]: 1, '   ': 2, '  padded  ': 3 })).toEqual({ padded: 3 });
  });

  it('caps a nested item list at 200 entries instead of rejecting it', () => {
    const parsed = parse({
      items: Array.from({ length: 250 }, (_, i) => ({ item_id: `sku-${i}` })),
    }) as { items: unknown[] };
    expect(parsed.items).toHaveLength(200);
  });

  it('keeps the first 64 properties in insertion order', () => {
    const parsed = parse(Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, i])));
    expect(Object.keys(parsed)).toHaveLength(64);
    expect(parsed.k63).toBe(63);
    expect(parsed.k64).toBeUndefined();
  });
});

describe('createTrackEventSchema', () => {
  const event = (properties: Record<string, unknown>) => ({
    name: 'click',
    visitor_id: '019485d9-8b41-7000-8000-000000000001',
    session_id: '019485d9-8b41-7000-8000-000000000002',
    platform: 'web' as const,
    environment: 'production' as const,
    timestamp: '2026-01-01T00:00:00.000Z',
    tags: {},
    properties,
  });

  it('does not lose the batch to one oversized value', () => {
    const parsed = createTrackEventSchema.parse([
      event({ link_text: 'a'.repeat(5000) }),
      event({ kept: 'second event' }),
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].properties?.link_text).toHaveLength(512);
    expect(parsed[1].properties?.kept).toBe('second event');
  });

  it('rejects an empty batch and non-uuid identity', () => {
    expect(() => createTrackEventSchema.parse([])).toThrow();
    expect(() =>
      createTrackEventSchema.parse([{ ...event({}), visitor_id: 'not-a-uuid' }])
    ).toThrow();
  });
});

describe('tagsSchema', () => {
  it('accepts the WxH screen resolution shape and rejects anything else', () => {
    expect(tagsSchema.parse({ screen_resolution: '390x844' }).screen_resolution).toBe('390x844');
    expect(() => tagsSchema.parse({ screen_resolution: '390' })).toThrow();
  });
});

describe('userProvidedDataSchema', () => {
  it('normalizes email casing and enforces E.164 phone numbers', () => {
    const parsed = userProvidedDataSchema.parse({
      email: '  Ada@Example.COM ',
      phone_number: '+14155551234',
    });
    expect(parsed.email).toBe('ada@example.com');
    expect(() => userProvidedDataSchema.parse({ phone_number: '(415) 555-1234' })).toThrow();
  });

  it('uppercases the two-letter country code and rejects longer forms', () => {
    const parsed = userProvidedDataSchema.parse({ address: { country: 'us' } });
    expect(parsed.address).toMatchObject({ country: 'US' });
    expect(() => userProvidedDataSchema.parse({ address: { country: 'USA' } })).toThrow();
  });

  it('caps the multi-value lists (3 emails, 2 addresses)', () => {
    const emails = ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co'];
    expect(() => userProvidedDataSchema.parse({ email: emails })).toThrow();
    expect(userProvidedDataSchema.parse({ email: emails.slice(0, 3) }).email).toHaveLength(3);
  });
});

describe('createLinkSchema', () => {
  const base = {
    url: 'https://x.test/promo',
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'spring',
  };

  it('turns an empty optional utm into undefined instead of storing ""', () => {
    const parsed = createLinkSchema.parse({ ...base, utm_term: '', utm_content: 'cta-a' });
    expect(parsed.utm_term).toBeUndefined();
    expect(parsed.utm_content).toBe('cta-a');
  });

  it('requires source, medium and campaign', () => {
    expect(() => createLinkSchema.parse({ url: 'https://x.test', utm_source: 'a' })).toThrow();
  });
});
