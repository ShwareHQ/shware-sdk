// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendOpenAIEvent, setOpenAIUser } from './openai-pixel';

const vendor = window as unknown as { oaiq?: unknown };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete vendor.oaiq;
  vi.restoreAllMocks();
});

describe('sendOpenAIEvent', () => {
  it('measures a standard event with the event id for deduplication', () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    sendOpenAIEvent(
      'purchase',
      { value: 12.5, currency: 'usd', transaction_id: 't1', items: [] },
      'event-1'
    );

    expect(oaiq).toHaveBeenCalledWith(
      'measure',
      'order_created',
      { type: 'contents', amount: 1250, currency: 'USD' },
      { event_id: 'event-1' }
    );
  });

  it('measures an unknown name as custom, carrying the original name', () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    sendOpenAIEvent('banner_dismissed', {}, 'event-2');

    expect(oaiq).toHaveBeenCalledWith(
      'measure',
      'custom',
      { type: 'custom' },
      { event_id: 'event-2', custom_event_name: 'banner_dismissed' }
    );
  });

  it('drops web vitals and promotion events', () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    sendOpenAIEvent('CLS', { value: 0.01 });
    sendOpenAIEvent('view_promotion', { items: [] });
    expect(oaiq).not.toHaveBeenCalled();
  });

  it('does not throw when the pixel never loaded', () => {
    expect(() => sendOpenAIEvent('purchase', undefined, 'e')).not.toThrow();
    expect(() => setOpenAIUser('p')({ user_id: 'u1', tags: {} })).not.toThrow();
  });
});

describe('setOpenAIUser', () => {
  it('hashes email and external id, normalizes geography, then re-inits', async () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    setOpenAIUser('pixel-1')({
      user_id: 'u1',
      user_data: {
        email: [' Ada@Example.COM ', 'ignored@x.co'],
        address: { city: ' London ', postal_code: 'SW1', country: ' gb ' },
      },
      tags: {},
    });

    // The init call is deferred until the SHA-256 digests resolve.
    await vi.waitFor(() => expect(oaiq).toHaveBeenCalled());
    expect(oaiq).toHaveBeenCalledWith('init', {
      pixelId: 'pixel-1',
      user: {
        country: 'GB',
        city: 'london',
        zip_code: 'SW1',
        email_sha256: sha256('ada@example.com'),
        external_id_sha256: sha256('u1'),
      },
    });
  });

  it('still inits with the raw fields when hashing fails', async () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('no webcrypto'));

    setOpenAIUser('pixel-1')({
      user_id: 'u1',
      user_data: { address: { country: 'US' } },
      tags: {},
    });

    await vi.waitFor(() => expect(oaiq).toHaveBeenCalled());
    expect(oaiq).toHaveBeenCalledWith('init', { pixelId: 'pixel-1', user: { country: 'US' } });
    digest.mockRestore();
  });
});
