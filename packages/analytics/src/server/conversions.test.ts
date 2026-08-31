import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEvent } from '../track/types';
import { sendEvents as sendLinkedinEvents } from './linkedin-conversions-api';
import { getServerEvent as metaServerEvent } from './meta-conversions-api';
import { getServerEvent as openaiServerEvent } from './openai-conversions-api';
import { getServerEvent as redditServerEvent } from './reddit-conversions-api';

const CREATED_AT = '2026-01-10T12:00:00.000Z';
const CREATED_MS = Date.parse(CREATED_AT);

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

beforeEach(() => {
  // Senders must not read the clock: everything they stamp comes from the event. A frozen clock
  // far from created_at turns any Date.now() regression into a visible assertion failure.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenAI', () => {
  it('is timed by the event, not by the send', () => {
    expect(openaiServerEvent(event(), {}).timestamp_ms).toBe(CREATED_MS);
  });

  it('maps the standard fields', () => {
    const out = openaiServerEvent(
      event({ tags: { page_location: 'https://x.test/p', idempotency_key: 'idem-1' } }),
      {}
    );
    expect(out).toMatchObject({
      id: 'idem-1',
      type: 'order_created',
      source_url: 'https://x.test/p',
      action_source: 'web',
      custom_event_name: undefined,
    });
  });

  it('derives the action source from the platform and lets an override win', () => {
    expect(openaiServerEvent(event({ platform: 'ios' }), {}).action_source).toBe('mobile_app');
    expect(openaiServerEvent(event({ platform: 'unknown' }), {}).action_source).toBeUndefined();
    expect(openaiServerEvent(event(), {}, 'offline').action_source).toBe('offline');
  });

  it('keeps the original name on a custom event so it deduplicates with the pixel', () => {
    const out = openaiServerEvent(event({ name: 'my_custom_thing', properties: {} }), {});
    expect(out.type).toBe('custom');
    expect(out.custom_event_name).toBe('my_custom_thing');
  });
});

describe('Reddit', () => {
  it('is timed by the event, not by the send', () => {
    expect(redditServerEvent(event(), {}).event_at).toBe(CREATED_MS);
  });

  it('maps platform to action_source, with UNKNOWN as the fallback', () => {
    expect(redditServerEvent(event(), {}).action_source).toBe('WEBSITE');
    expect(redditServerEvent(event({ platform: 'android' }), {}).action_source).toBe('APP');
    expect(redditServerEvent(event({ platform: 'unknown' }), {}).action_source).toBe('UNKNOWN');
    expect(redditServerEvent(event(), {}, 'offline').action_source).toBe('UNKNOWN');
  });

  it('routes the advertising id by platform', () => {
    const tags = { advertising_id: 'ad-id-1' };
    expect(redditServerEvent(event({ platform: 'ios', tags }), {}).user).toMatchObject({
      idfa: 'ad-id-1',
      aaid: undefined,
    });
    expect(redditServerEvent(event({ platform: 'android', tags }), {}).user).toMatchObject({
      idfa: undefined,
      aaid: 'ad-id-1',
    });
  });

  it('uses the event id for deduplication', () => {
    const out = redditServerEvent(event(), {});
    expect(out.metadata?.conversion_id).toBe('event-1');
    expect(out.type.tracking_type).toBe('PURCHASE'); // server enum, uppercased
  });
});

describe('Meta', () => {
  it('is timed by the event, in seconds', () => {
    const out = metaServerEvent(event(), {});
    expect(out.event_time).toBe(Math.round(CREATED_MS / 1000));
  });

  it('synthesizes _fbc from a bare fbclid at the event time', () => {
    const out = metaServerEvent(event({ tags: { fbclid: 'CLICK123' } }), {});
    expect(out.user_data.fbc).toBe(`fb.1.${CREATED_MS}.CLICK123`);
  });

  it('prefers a real _fbc cookie over synthesis', () => {
    const out = metaServerEvent(event({ tags: { fbc: 'fb.1.111.REAL', fbclid: 'IGNORED' } }), {});
    expect(out.user_data.fbc).toBe('fb.1.111.REAL');
  });

  it('always sends an action_source, falling back to other', () => {
    expect(metaServerEvent(event(), {}).action_source).toBe('website');
    expect(metaServerEvent(event({ platform: 'ios' }), {}).action_source).toBe('app');
    expect(metaServerEvent(event({ platform: 'unknown' }), {}).action_source).toBe('other');
    expect(metaServerEvent(event(), {}, undefined, 'offline').action_source).toBe('other');
  });

  it('attaches app data only for an app event with a package name', () => {
    const web = metaServerEvent(event(), {}, 'com.example.app');
    expect(web.app_data).toBeUndefined();
    const app = metaServerEvent(event({ platform: 'ios' }), {}, 'com.example.app');
    expect(app.app_data).toBeDefined();
  });

  it('dedupes on the idempotency key when present', () => {
    expect(metaServerEvent(event(), {}).event_id).toBe('event-1');
    expect(metaServerEvent(event({ tags: { idempotency_key: 'idem-9' } }), {}).event_id).toBe(
      'idem-9'
    );
  });

  it('maps scalar user-provided data onto Meta user_data', () => {
    const { user_data } = metaServerEvent(event(), {
      email: 'ada@example.com',
      phone_number: '+14155551234',
      gender: 'female',
      user_id: 'u1',
      ip_address: '203.0.113.9',
      user_agent: 'UA/1.0',
      birthday: { year: 1990, month: 12, day: 3 },
      address: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        city: 'London',
        region: 'ENG',
        postal_code: 'SW1',
        country: 'GB',
      },
    });

    expect(user_data.emails).toEqual(['ada@example.com']);
    expect(user_data.phones).toEqual(['+14155551234']);
    expect(user_data.genders).toEqual(['f']);
    expect(user_data.external_ids).toEqual(['u1']);
    expect(user_data.client_ip_address).toBe('203.0.113.9');
    expect(user_data.client_user_agent).toBe('UA/1.0');
    expect(user_data.doby).toBe('1990');
    expect(user_data.dobm).toBe('12');
    expect(user_data.dobd).toBe('3');
    expect(user_data.first_names).toEqual(['Ada']);
    expect(user_data.last_names).toEqual(['Lovelace']);
    expect(user_data.cities).toEqual(['London']);
    expect(user_data.states).toEqual(['ENG']);
    expect(user_data.zips).toEqual(['SW1']);
    expect(user_data.countries).toEqual(['gb']); // lowercased for Meta
  });

  it('maps multi-value user data as parallel lists', () => {
    const { user_data } = metaServerEvent(event(), {
      email: ['a@x.co', 'b@x.co'],
      phone_number: ['+14155551234', '+14155551235'],
      address: [
        { first_name: 'Ada', country: 'GB' },
        { first_name: 'Grace', country: 'US' },
      ],
    });

    expect(user_data.emails).toEqual(['a@x.co', 'b@x.co']);
    expect(user_data.phones).toEqual(['+14155551234', '+14155551235']);
    expect(user_data.first_names).toEqual(['Ada', 'Grace']);
    expect(user_data.countries).toEqual(['gb', 'us']);
  });

  it('drops user-assigned country codes Meta cannot match (Kosovo)', () => {
    const single = metaServerEvent(event(), { address: { country: 'XK' } });
    expect(single.user_data.countries).toBeUndefined();

    const list = metaServerEvent(event(), { address: [{ country: 'xk' }, { country: 'de' }] });
    expect(list.user_data.countries).toEqual(['de']);
  });

  it('builds custom_data from the mapped event, catalog fields split out', () => {
    const { custom_data } = metaServerEvent(
      event({
        properties: {
          value: 99.5,
          currency: 'usd',
          transaction_id: 'txn-1',
          items: [
            {
              item_id: 'sku-1',
              item_name: 'One',
              item_category: 'plans',
              price: 49.75,
              quantity: 2,
            },
          ],
        },
      }),
      {}
    );

    expect(custom_data.value).toBe(99.5);
    expect(custom_data.currency).toBe('usd');
    expect(custom_data.content_ids).toEqual(['sku-1']);
    expect(custom_data.num_items).toBe(2);
    expect(custom_data.contents).toHaveLength(1);
    expect(custom_data.contents[0]).toMatchObject({ _id: 'sku-1', _quantity: 2 });
  });

  it('keeps unmapped custom event properties as custom_properties', () => {
    const { custom_data } = metaServerEvent(
      event({ name: 'plan_upgraded', properties: { plan: 'pro', seats: 5 } }),
      {}
    );
    expect(custom_data.custom_properties).toEqual({ plan: 'pro', seats: 5 });
  });

  it('stamps app events with the device extinfo for the right OS family', () => {
    const tags = { os_name: 'iOS', os_version: '19.0', release: '7.3.1', language: 'en-US' };
    const ios = metaServerEvent(event({ platform: 'ios', tags }), {}, 'com.example.app');
    expect(ios.app_data.extinfo.ext_info_version).toBe('i2');

    const android = metaServerEvent(
      event({ platform: 'android', tags: { ...tags, os_name: 'Android' } }),
      {},
      'com.example.app'
    );
    expect(android.app_data.extinfo.ext_info_version).toBe('a2');
  });
});

describe('LinkedIn', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends only configured events, timed by the event', async () => {
    await sendLinkedinEvents(
      'token',
      { purchase: 123 },
      [event(), event({ id: 'event-2', name: 'click' })],
      {}
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0]).toMatchObject({
      eventId: 'event-1',
      conversion: 'urn:lla:llaPartnerConversion:123',
      conversionHappenedAt: CREATED_MS,
      conversionValue: { currencyCode: 'USD', amount: '42' },
    });
  });

  it('puts the first-party click id first among the user ids', async () => {
    await sendLinkedinEvents(
      'token',
      { purchase: 123 },
      [event({ tags: { li_fat_id: 'li-click-1' } })],
      { user_id: 'u1', email: 'a@b.co' }
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const ids = body.elements[0].user.userIds;
    expect(ids[0]).toEqual({
      idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',
      idValue: 'li-click-1',
    });
    expect(ids.some((i: { idType: string }) => i.idType === 'SHA256_EMAIL')).toBe(true);
  });

  it('sends nothing when no event matches the config', async () => {
    await sendLinkedinEvents('token', { purchase: 123 }, [event({ name: 'click' })], {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
