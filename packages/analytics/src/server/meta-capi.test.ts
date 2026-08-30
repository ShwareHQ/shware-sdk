// oxlint-disable vitest/expect-expect -- the differential tests assert inside expectSamePayload
/**
 * The contract of the lightweight Meta sender is byte-equality with the business SDK: for the
 * same events, `getCapiEvent` must produce exactly what `ServerEvent.normalize()` would put on
 * the wire — every hash, every key, the sparse extinfo object included. Three layers enforce it:
 * a field-by-field differential suite, a seeded fuzz differential over randomized inputs, and
 * known-vector hash tests that pin the normalization rules to concrete SHA-256 values so they
 * survive even if the business SDK ever leaves the dev dependencies.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEvent, UserProvidedData } from '../track/types';
import { getCapiEvent, sendMetaConversions } from './meta-capi';
import { getServerEvent } from './meta-conversions-api';

const CREATED_AT = '2026-01-10T12:00:00.000Z';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function event(partial: Partial<TrackEvent<any>> = {}): TrackEvent<any> {
  return {
    id: 'event-1',
    name: 'purchase',
    tags: {},
    visitor_id: 'v1',
    session_id: 's1',
    platform: 'web',
    environment: 'production',
    properties: { value: 42, currency: 'usd', items: [] },
    created_at: CREATED_AT,
    ...partial,
  };
}

/** JSON round-trip drops undefined values on both sides, exactly as serialization would. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function expectSamePayload(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  trackEvent: TrackEvent<any>,
  data: UserProvidedData = {},
  appPackageName?: string
) {
  const sdk = wire(getServerEvent(trackEvent, data, appPackageName).normalize());
  const capi = wire(getCapiEvent(trackEvent, data, appPackageName));
  expect(capi).toEqual(sdk);
}

describe('differential: getCapiEvent === business SDK normalize()', () => {
  it('a purchase with the full single-address identity block', () => {
    expectSamePayload(
      event({
        tags: {
          page_location: 'https://shop.example/checkout?step=2',
          fbp: 'fb.1.1700000000000.987654',
          fbc: 'fb.1.1700000000000.CLK1',
          idempotency_key: 'idem-1',
        },
        properties: {
          value: 99.5,
          currency: 'usd',
          transaction_id: 'txn-1',
          items: [
            {
              item_id: 'sku-1',
              item_name: 'One',
              item_brand: 'Acme',
              item_category: 'plans',
              price: 49.75,
              quantity: 2,
            },
          ],
        },
      }),
      {
        email: ' Ada@Example.COM ',
        phone_number: '+1 (415) 555-1234',
        gender: 'female',
        user_id: 'user-123',
        ip_address: '203.0.113.9',
        user_agent: 'Mozilla/5.0 UA',
        fb_login_id: '12345',
        fb_page_id: 'page-1',
        birthday: { year: 1990, month: 12, day: 3 },
        address: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          city: 'London',
          region: 'ENG',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
      }
    );
  });

  it('a minimal event: empty tags, no user data', () => {
    expectSamePayload(event());
    expectSamePayload(event({ name: 'contact', properties: undefined }));
  });

  it('the punctuation-and-accent name matrix the two vendor libraries disagree on', () => {
    // These are the inputs where the param builder normalizes differently than the business
    // SDK (hyphens, apostrophes, inner spaces, accents). The sender must side with the SDK.
    expectSamePayload(event(), {
      email: 'a.d+tag@X.co',
      address: {
        first_name: ' Mary-Jane ',
        last_name: 'van der Berg',
        city: 'São Paulo',
        region: 'B.C.',
        postal_code: '94025-1234',
        country: 'us',
      },
    });
    expectSamePayload(event(), {
      address: { first_name: "O'Brien", city: 'New-York.', region: ' eng ', postal_code: '10001' },
    });
  });

  it('names past five characters slice into the same f5 prefixes', () => {
    expectSamePayload(event(), {
      address: { first_name: 'Alexander', last_name: 'Fitzgerald-Smith' },
    });
  });

  it('single-digit birthday fields pad the same way', () => {
    expectSamePayload(event(), { birthday: { year: 1985, month: 2, day: 7 } });
  });

  it('multi-value emails, phones and addresses as parallel lists', () => {
    expectSamePayload(event(), {
      email: ['a@x.co', 'b@x.co'],
      phone_number: ['+14155551234', '0044 20 7946 0018'],
      address: [
        { first_name: 'Ada', last_name: 'Lovelace', city: 'London', region: 'ENG', country: 'GB' },
        {
          first_name: 'Grace',
          city: 'New York',
          region: 'NY',
          postal_code: '10001',
          country: 'us',
        },
      ],
    });
    // Sparse columns: some addresses miss fields the others carry.
    expectSamePayload(event(), {
      address: [{ first_name: 'Ada' }, { city: 'Berlin', country: 'de' }],
    });
    // Duplicates collapse after hashing — the SDK dedupes every multi-value field.
    expectSamePayload(event(), {
      email: ['a@x.co', ' A@X.CO '],
      phone_number: ['+14155551234', '14155551234'],
      address: [
        { first_name: 'Ada', country: 'GB' },
        { first_name: ' ADA ', country: 'gb' },
      ],
    });
  });

  it('a pre-hashed email passes through unhashed-again on both sides', () => {
    const prehashed = 'B5FC85E55755F9E0D030A10AB4429B6B2944855F9A0D60077FE832BECBC41D72';
    expectSamePayload(event(), { email: prehashed });
  });

  it('an app event carries the same sparse extinfo object', () => {
    const tags = {
      os_name: 'iOS',
      os_version: '19.0',
      release: '7.4.0',
      language: 'en-US',
      device_model_id: 'iPhone17,1',
      device_pixel_ratio: 3,
      screen_width: 390,
      screen_height: 844,
      advertising_id: 'ABCD-EFGH',
      install_referrer: 'utm_source=meta',
    };
    expectSamePayload(event({ platform: 'ios', tags }), {}, 'com.example.app');
    expectSamePayload(
      event({ platform: 'android', tags: { ...tags, os_name: 'Android' } }),
      {},
      'com.example.app'
    );
    // An OS the version map does not know leaves extinfo without a version, as the SDK does.
    expectSamePayload(
      event({ platform: 'windows', tags: { ...tags, os_name: 'Windows' } }),
      {},
      'com.example.app'
    );
    // No package name means no app_data, whatever the platform.
    expectSamePayload(event({ platform: 'ios', tags }));
  });

  it('synthesizes _fbc from a bare fbclid at the event time, like the SDK path', () => {
    expectSamePayload(event({ tags: { fbclid: 'CLK99' } }));
    // A real cookie outranks synthesis.
    expectSamePayload(event({ tags: { fbclid: 'IGNORED', fbc: 'fb.1.111.REAL' } }));
  });

  it('tags-only identity: fbp, madid, ip — and tags.ip outranks the caller ip', () => {
    expectSamePayload(
      event({ tags: { fbp: 'fb.1.1.2', advertising_id: 'IDFA-1', ip_address: '198.51.100.7' } }),
      { ip_address: '203.0.113.9' }
    );
  });

  it('a legacy client still sending source_url keeps its event_source_url', () => {
    expectSamePayload(event({ tags: { source_url: 'https://shop.example/old-bundle' } }));
  });

  it('event_time rounds the same sub-second timestamp', () => {
    expectSamePayload(event({ created_at: '2026-01-10T12:00:00.700Z' }));
  });

  it('every internal-to-Meta event mapping agrees', () => {
    const cart = {
      value: 10,
      currency: 'eur',
      items: [{ item_id: 'sku-1', item_name: 'One', price: 5, quantity: 2 }],
    };
    expectSamePayload(event({ name: 'add_payment_info', properties: cart }));
    expectSamePayload(event({ name: 'add_to_cart', properties: cart }));
    expectSamePayload(event({ name: 'add_to_wishlist', properties: cart }));
    expectSamePayload(event({ name: 'login', properties: { method: 'email' } }));
    expectSamePayload(event({ name: 'contact', properties: {} }));
    expectSamePayload(event({ name: 'customize_product', properties: {} }));
    expectSamePayload(event({ name: 'donate', properties: {} }));
    expectSamePayload(event({ name: 'find_location', properties: {} }));
    expectSamePayload(event({ name: 'begin_checkout', properties: cart }));
    expectSamePayload(event({ name: 'generate_lead', properties: { value: 1, currency: 'usd' } }));
    expectSamePayload(event({ name: 'purchase', properties: undefined })); // USD/0 defaults
    expectSamePayload(event({ name: 'schedule', properties: {} }));
    expectSamePayload(event({ name: 'search', properties: { search_term: 'shoes' } }));
    expectSamePayload(event({ name: 'trial_begin', properties: { value: 9, currency: 'usd' } }));
    expectSamePayload(event({ name: 'submit_application', properties: {} }));
    expectSamePayload(event({ name: 'subscribe', properties: { value: 9, currency: 'usd' } }));
    expectSamePayload(event({ name: 'view_item', properties: cart }));
    expectSamePayload(event({ name: 'custom_thing', properties: { plan: 'pro', seats: 5 } }));
  });

  it('every custom_data field flows identically, value 0 included', () => {
    expectSamePayload(
      event({
        name: 'custom_full',
        properties: {
          value: 0,
          currency: ' usd ',
          content_name: 'One',
          content_category: 'plans',
          content_ids: ['sku-1', 'sku-2'],
          contents: [
            {
              id: 'sku-1',
              quantity: 2,
              item_price: 49.75,
              title: 'One',
              description: 'A plan',
              brand: 'Acme',
              category: 'plans',
              delivery_category: 'Home_Delivery',
            },
          ],
          content_type: 'product',
          predicted_ltv: 500,
          num_items: 3,
          search_string: 'shoes',
          status: true,
          delivery_category: 'in_store',
          plan: 'pro',
        },
      })
    );
  });

  it('action_source derives from the platform on both sides', () => {
    for (const platform of ['web', 'ios', 'android', 'macos', 'unknown'] as const) {
      expectSamePayload(event({ platform }));
    }
  });

  it('drops the user-assigned Kosovo country code on both sides', () => {
    expectSamePayload(event(), { address: { country: 'XK', city: 'Pristina' } });
    expectSamePayload(event(), {
      address: [{ country: 'xk' }, { country: 'de', first_name: 'Max' }],
    });
  });

  it('dedupes on the idempotency key when present', () => {
    expectSamePayload(event({ tags: { idempotency_key: 'idem-9' } }));
  });
});

describe('differential fuzz: seeded random inputs through both builders', () => {
  /** mulberry32 — deterministic, so a failure is reproducible from the printed seed. */
  function prng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('120 randomized events and identities produce identical payloads', () => {
    const random = prng(20260110);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
    const maybe = <T>(value: T): T | undefined => (random() < 0.5 ? value : undefined);

    // Free-text pools deliberately carry the characters the two vendor libraries disagree on;
    // the constrained pools (emails, phones, countries) stay inside what the business SDK
    // accepts without throwing, since a thrown batch has no payload to compare.
    const names = ['Ada', ' Mary-Jane ', "O'Brien", 'José', 'van der Berg', 'Fitzgerald-Smith'];
    const cities = ['London', 'San Jose', 'São Paulo', 'New-York.', ' berlin '];
    const regions = ['CA', 'ENG', 'B.C.', ' eng ', 'NY'];
    const zips = ['94025-1234', 'SW1A 1AA', '10001', '100-8111', 'EC1A1BB'];
    const emails = ['a@x.co', ' Ada@Example.COM ', 'a.d+tag@X.co', 'b@y.example'];
    const phones = ['+14155551234', '0044 20 7946 0018', '+1 (415) 555-1234', '4155551234'];
    const countries = ['us', 'GB', 'de', 'FR', 'jp'];
    const eventNames = ['purchase', 'add_to_cart', 'search', 'subscribe', 'custom_thing'];

    for (let i = 0; i < 120; i++) {
      const address = () => ({
        first_name: maybe(pick(names)),
        last_name: maybe(pick(names)),
        city: maybe(pick(cities)),
        region: maybe(pick(regions)),
        postal_code: maybe(pick(zips)),
        country: maybe(pick(countries)),
      });
      const data: UserProvidedData = {
        email: maybe(random() < 0.5 ? pick(emails) : [pick(emails), pick(emails)]),
        phone_number: maybe(random() < 0.5 ? pick(phones) : [pick(phones), pick(phones)]),
        gender: maybe(pick(['female', 'male'] as const)),
        user_id: maybe(`user-${i}`),
        ip_address: maybe('203.0.113.9'),
        user_agent: maybe('UA/1.0'),
        birthday: maybe({
          year: 1950 + Math.floor(random() * 60),
          month: 1 + Math.floor(random() * 12),
          day: 1 + Math.floor(random() * 28),
        }),
        address: maybe(random() < 0.5 ? address() : [address(), address()]),
      };
      const trackEvent = event({
        name: pick(eventNames),
        platform: pick(['web', 'ios', 'android', 'unknown'] as const),
        properties: {
          value: maybe(Math.round(random() * 10000) / 100),
          currency: maybe(pick(['usd', 'EUR', ' jpy '])),
          search_term: maybe('shoes'),
          items: maybe([
            {
              item_id: `sku-${i}`,
              item_name: pick(names),
              price: maybe(Math.round(random() * 1000) / 100),
              quantity: maybe(1 + Math.floor(random() * 3)),
            },
          ]),
        },
        tags: {
          fbclid: maybe(`CLK${i}`),
          fbc: maybe('fb.1.1700000000000.COOKIE'),
          fbp: maybe('fb.1.1700000000000.987654'),
          advertising_id: maybe('IDFA-1'),
          ip_address: maybe('198.51.100.7'),
          page_location: maybe('https://shop.example/p'),
          idempotency_key: maybe(`idem-${i}`),
        },
      });
      const appPackageName = maybe('com.example.app');

      try {
        expectSamePayload(trackEvent, data, appPackageName);
      } catch (error) {
        console.error(`fuzz case ${i} diverged`, JSON.stringify({ trackEvent, data }));
        throw error;
      }
    }
  });
});

describe('the normalization rules, pinned to concrete hashes', () => {
  const userData = (data: UserProvidedData, tags = {}) =>
    getCapiEvent(event({ tags }), data).user_data;

  it('email: trim + lowercase', () => {
    expect(userData({ email: ' Ada@Example.COM ' }).em).toEqual([sha256('ada@example.com')]);
  });

  it('phone: strip formatting and letters, drop international prefix zeros', () => {
    expect(userData({ phone_number: '+1 (415) 555-1234' }).ph).toEqual([sha256('14155551234')]);
    expect(userData({ phone_number: '0044 20 7946 0018' }).ph).toEqual([sha256('442079460018')]);
  });

  it('names: trim + lowercase, punctuation and inner spaces kept (SDK rule, not the docs rule)', () => {
    const { fn, ln } = userData({
      address: { first_name: ' Mary-Jane ', last_name: 'van der Berg' },
    });
    expect(fn).toEqual([sha256('mary-jane')]);
    expect(ln).toEqual([sha256('van der berg')]);
  });

  it('f5 prefixes: sliced to five characters before normalization', () => {
    const { f5first, f5last } = userData({
      address: { first_name: 'Alexander', last_name: 'Ng' },
    });
    expect(f5first).toBe(sha256('alexa'));
    expect(f5last).toBe(sha256('ng'));
  });

  it('city/state: digits, whitespace, parens, dots and hyphens removed; accents kept', () => {
    const { ct, st } = userData({
      address: { city: 'San Jose (Downtown) 95', region: 'B.C.' },
    });
    expect(ct).toEqual([sha256('sanjosedowntown')]);
    expect(st).toEqual([sha256('bc')]);
  });

  it('zip: spaces removed, dash suffix cut', () => {
    expect(userData({ address: { postal_code: '94025-1234' } }).zp).toEqual([sha256('94025')]);
    expect(userData({ address: { postal_code: 'SW1A 1AA' } }).zp).toEqual([sha256('sw1a1aa')]);
  });

  it('country lowercased; gender as a lowercase initial', () => {
    expect(userData({ address: { country: 'GB' } }).country).toEqual([sha256('gb')]);
    expect(userData({ gender: 'female' }).ge).toEqual([sha256('f')]);
    expect(userData({ gender: 'male' }).ge).toEqual([sha256('m')]);
  });

  it('birthday: zero-padded day and month, four-digit year, hashed separately', () => {
    const { dobd, dobm, doby } = userData({ birthday: { year: 1990, month: 2, day: 7 } });
    expect(dobd).toBe(sha256('07'));
    expect(dobm).toBe(sha256('02'));
    expect(doby).toBe(sha256('1990'));
  });

  it('pre-hashed values pass through lowercased, SHA-256 and MD5 alike', () => {
    const sha = sha256('ada@example.com');
    expect(userData({ email: sha.toUpperCase() }).em).toEqual([sha]);
    const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
    expect(userData({ address: { first_name: md5 } }).fn).toEqual([md5]);
  });

  it('never hashed: external_id, ip, user agent, cookies, madid, page id, login id', () => {
    const out = userData(
      {
        user_id: 'user-123',
        ip_address: '203.0.113.9',
        user_agent: 'UA/1.0',
        fb_login_id: '12345',
        fb_page_id: 'page-1',
      },
      { fbc: 'fb.1.1.CLK', fbp: 'fb.1.1.987', advertising_id: 'IDFA-1' }
    );
    expect(out).toMatchObject({
      external_id: ['user-123'],
      client_ip_address: '203.0.113.9',
      client_user_agent: 'UA/1.0',
      fb_login_id: '12345',
      page_id: 'page-1',
      fbc: 'fb.1.1.CLK',
      fbp: 'fb.1.1.987',
      madid: 'IDFA-1',
    });
  });
});

describe('deliberate divergences from the business SDK, on invalid input only', () => {
  it('a degenerate zip is dropped instead of shipping [null]', () => {
    // The SDK normalizes a sub-2-character zip to null and sends `zp: [null]`.
    expect(getCapiEvent(event(), { address: { postal_code: 'a' } }).user_data.zp).toBeUndefined();
  });

  it('an unknown country code is forwarded hashed instead of throwing away the batch', () => {
    // The SDK throws on a non-ISO alpha-2 code inside execute(), losing every event with it.
    const out = getCapiEvent(event(), { address: { country: 'ZZ' } });
    expect(out.user_data.country?.[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a malformed email hashes deterministically instead of throwing away the batch', () => {
    const out = getCapiEvent(event(), { email: 'not-an-email' });
    expect(out.user_data.em?.[0] ?? 'absent').toMatch(/^[a-f0-9]{64}$|^absent$/);
  });
});

describe('sendMetaConversions transport', () => {
  const fetchMock = vi.fn();
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the batch as JSON to the versioned events endpoint, token in the body', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace-1' }), { status: 200 })
    );

    const result = await sendMetaConversions('secret-token', 'pixel-1', [
      event({ name: 'session_start' }),
      event(),
    ]);

    expect(result).toEqual({ events_received: 1, fbtrace_id: 'trace-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v24.0/pixel-1/events');
    expect(url).not.toContain('secret-token'); // the token must never ride in the URL
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.access_token).toBe('secret-token');
    expect(body.test_event_code).toBeUndefined();
    expect(body.data).toHaveLength(1); // session_start filtered out
    expect(body.data[0]).toMatchObject({ event_name: 'Purchase', action_source: 'website' });
  });

  it('attaches app_data via options.appPackageName for app-platform events', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendMetaConversions(
      't',
      'pixel-1',
      [event({ platform: 'ios', tags: { os_name: 'iOS' } }), event()],
      {},
      { appPackageName: 'com.example.app' }
    );

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.data[0].action_source).toBe('app');
    expect(body.data[0].app_data.extinfo).toEqual({ 0: 'i2', 1: 'com.example.app' });
    expect(body.data[1].app_data).toBeUndefined(); // the web event stays app-less
  });

  it('routes a test batch with test_event_code and honors an apiVersion override', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await sendMetaConversions(
      't',
      'pixel-1',
      [event()],
      {},
      {
        testEventCode: 'TEST99',
        apiVersion: 'v25.0',
      }
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v25.0/pixel-1/events');
    expect(JSON.parse(init.body as string).test_event_code).toBe('TEST99');
  });

  it('sends nothing when every event is auto-collected', async () => {
    await sendMetaConversions('t', 'pixel-1', [event({ name: 'page_view' })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a rejected batch without throwing and without leaking the token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 })
    );

    await expect(sendMetaConversions('secret-token', 'p', [event()])).resolves.toBeUndefined();
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('status: 400');
    expect(logged).not.toContain('secret-token');
  });

  it('absorbs a network failure after the retry wrapper gives up', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('offline'));

    const pending = sendMetaConversions('t', 'p', [event()]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('network error');
    vi.useRealTimers();
  });
});
