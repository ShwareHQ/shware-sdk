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

  it('names a custom event as the API allows, and sends none it cannot name', () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    sendOpenAIEvent('Banner.Dismissed' as never, undefined, 'event-3');
    expect(oaiq).toHaveBeenCalledWith('measure', 'custom', expect.anything(), {
      event_id: 'event-3',
      custom_event_name: 'banner_dismissed',
    });

    oaiq.mockClear();
    sendOpenAIEvent('...' as never, undefined, 'event-4');
    expect(oaiq).not.toHaveBeenCalled();
  });

  it('leaves the app events to the Conversions API', () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    sendOpenAIEvent('app_open');
    sendOpenAIEvent('first_open', {} as never);

    expect(oaiq).not.toHaveBeenCalled();
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
  it('hashes the identifiers as OpenAI normalizes them, sends geography raw, then re-inits', async () => {
    const oaiq = vi.fn();
    vendor.oaiq = oaiq;

    setOpenAIUser('pixel-1')({
      user_id: ' u1 ',
      user_data: {
        email: [' Ada@Example.COM ', 'ignored@x.co'],
        phone_number: '+1 (415) 555-2671',
        address: {
          first_name: 'Mary Jane',
          last_name: "O'Connor",
          city: ' London ',
          region: 'Greater London',
          postal_code: ' SW1 ',
          country: ' gb ',
        },
      },
      tags: {},
    });

    // The init call is deferred until the SHA-256 digests resolve.
    await vi.waitFor(() => expect(oaiq).toHaveBeenCalled());
    expect(oaiq).toHaveBeenCalledWith('init', {
      pixelId: 'pixel-1',
      user: {
        country: 'GB',
        city: 'London',
        region: 'Greater London',
        // `postal_code`, as the pixel documents it — not the `zip_code` it was sent as before.
        postal_code: 'SW1',
        email_sha256: sha256('ada@example.com'),
        // The digest of the documentation's own example.
        phone_number_sha256: '758fbf68945f21c416814c539ab578876c8d98fb69e6da692def92cd52417fe0',
        external_id_sha256: sha256('u1'),
        first_name_sha256: sha256('maryjane'),
        last_name_sha256: sha256('oconnor'),
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
