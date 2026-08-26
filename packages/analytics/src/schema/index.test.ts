import { describe, expect, it } from 'vitest';
import { createTrackEventSchema, propertiesSchema } from './index';

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
});
