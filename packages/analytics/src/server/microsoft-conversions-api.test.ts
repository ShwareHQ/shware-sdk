import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEvent } from '../track/types';
import { getServerEvent, normalizeEmail, sendEvents } from './microsoft-conversions-api';

const CREATED_AT = '2026-01-10T12:00:00.000Z';
const CREATED_SEC = Math.round(Date.parse(CREATED_AT) / 1000);

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
    properties: { value: 42, currency: 'usd', transaction_id: 'txn-1', items: [] },
    created_at: CREATED_AT,
    ...partial,
  };
}

beforeEach(() => {
  // Senders must not read the clock: everything they stamp comes from the event.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalizeEmail', () => {
  it('strips dots and a +alias from the user part of every domain, then lowercases', () => {
    expect(normalizeEmail('  John.Doe+promo@Contoso.com ')).toBe('johndoe@contoso.com');
    // Unlike Google's rule this is not gmail-only.
    expect(normalizeEmail('a.b+c@example.org')).toBe('ab@example.org');
  });

  it('matches the documented vector', () => {
    expect(sha256(normalizeEmail('john@contoso.com'))).toBe(
      'ec81f3ac7b2b19675bab9d54cf416f9f18cff87c97da5cca82c0f0891bc40602'
    );
  });
});

describe('getServerEvent', () => {
  it('is timed by the event in seconds, named after the event, deduplicated by its id', () => {
    const out = getServerEvent(event());
    expect(out).toMatchObject({
      eventType: 'custom',
      eventId: 'event-1',
      eventName: 'purchase',
      eventTime: CREATED_SEC,
    });
  });

  it('dedupes on the idempotency key when present', () => {
    expect(getServerEvent(event({ tags: { idempotency_key: 'idem-9' } })).eventId).toBe('idem-9');
  });

  it('carries the page context under the API names', () => {
    const out = getServerEvent(
      event({
        tags: {
          page_location: 'https://x.test/p',
          page_referrer: 'https://bing.com/',
          page_title: 'Pricing',
        },
      })
    );
    expect(out).toMatchObject({
      eventSourceUrl: 'https://x.test/p',
      referrerUrl: 'https://bing.com/',
      pageTitle: 'Pricing',
    });
  });

  it('falls back to the pre-7.0 source_url for the page URL', () => {
    const out = getServerEvent(event({ tags: { source_url: 'https://old.test/p' } }));
    expect(out.eventSourceUrl).toBe('https://old.test/p');
  });

  it('maps a page_view onto a pageLoad event with no name and no custom data', () => {
    const out = getServerEvent(
      event({ name: 'page_view', properties: {}, tags: { page_location: 'https://x.test/' } })
    );
    expect(out.eventType).toBe('pageLoad');
    expect(out.eventName).toBeUndefined();
    expect(out.customData).toBeUndefined();
  });

  it('maps the commerce fields onto customData', () => {
    const out = getServerEvent(
      event({
        properties: {
          value: 99.5,
          currency: 'usd',
          transaction_id: 'txn-1',
          items: [{ item_id: 'sku-1', item_name: 'One', price: 49.5, quantity: 2 }],
        },
      })
    );
    expect(out.customData).toEqual({
      value: 99.5,
      currency: 'USD',
      transactionId: 'txn-1',
      items: [{ id: 'sku-1', name: 'One', price: 49.5, quantity: 2 }],
    });
  });

  it('passes the custom-goal and retail fields through', () => {
    const out = getServerEvent(
      event({
        name: 'started_trial',
        properties: {
          event_category: 'trial',
          event_label: 'pro',
          event_value: 3,
          ecomm_prodid: 'prod-1',
          ecomm_pagetype: 'product',
          ecomm_totalvalue: 12,
          ecomm_category: 'plans',
        },
      })
    );
    expect(out.eventName).toBe('started_trial');
    expect(out.customData).toEqual({
      eventCategory: 'trial',
      eventLabel: 'pro',
      eventValue: 3,
      itemIds: ['prod-1'],
      pageType: 'product',
      ecommTotalValue: 12,
      ecommCategory: 'plans',
    });
  });

  it('omits customData when an event carries nothing the API knows', () => {
    expect(getServerEvent(event({ name: 'login', properties: {} })).customData).toBeUndefined();
  });

  it('hashes the identifiers and formats the click id as a dashed UUID', () => {
    const { userData } = getServerEvent(
      event({ tags: { msclkid: 'DD4AFCCCB1C94A4CAD9544DD7E5006AB' } }),
      {
        email: ['john@contoso.com', 'second@contoso.com'],
        phone_number: '+14255551234',
        user_id: 'u1',
        ip_address: '203.0.113.9',
        user_agent: 'UA/1.0',
      }
    );
    expect(userData).toEqual({
      msclkid: 'dd4afccc-b1c9-4a4c-ad95-44dd7e5006ab',
      em: 'ec81f3ac7b2b19675bab9d54cf416f9f18cff87c97da5cca82c0f0891bc40602',
      ph: 'c59475d96e9f01d7d18d06cfad84dd02333207f02c0c2c5663ef2782cda0390e',
      anonymousId: 'v1',
      externalId: sha256('u1'),
      clientUserAgent: 'UA/1.0',
      clientIpAddress: '203.0.113.9',
    });
  });

  it('drops a phone that is not E.164 instead of guessing a country code', () => {
    expect(getServerEvent(event(), { phone_number: '13800138000' }).userData.ph).toBeUndefined();
    expect(getServerEvent(event(), { phone_number: '+1 (425) 555-1234' }).userData.ph).toBe(
      'c59475d96e9f01d7d18d06cfad84dd02333207f02c0c2c5663ef2782cda0390e'
    );
  });

  it('passes a pre-hashed email and phone through untouched', () => {
    const em = 'a'.repeat(64);
    const { userData } = getServerEvent(event(), { email: em.toUpperCase(), phone_number: em });
    expect(userData.em).toBe(em);
    expect(userData.ph).toBe(em);
  });

  it('routes the advertising id by platform', () => {
    const tags = { advertising_id: 'ad-id-1' };
    expect(getServerEvent(event({ platform: 'ios', tags })).userData).toMatchObject({
      idfa: 'ad-id-1',
      gaid: undefined,
    });
    expect(getServerEvent(event({ platform: 'android', tags })).userData).toMatchObject({
      idfa: undefined,
      gaid: 'ad-id-1',
    });
  });

  it('encodes consent as G/D and omits it when unstated', () => {
    expect(getServerEvent(event(), {}, 'granted').adStorageConsent).toBe('G');
    expect(getServerEvent(event(), {}, 'denied').adStorageConsent).toBe('D');
    expect(getServerEvent(event()).adStorageConsent).toBeUndefined();
  });
});

describe('sendEvents', () => {
  it('POSTs a compact batch to the tag endpoint with the token in the Authorization header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ eventsReceived: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const responses = await sendEvents('secret-token', 97267979, [event()], {
      email: 'john@contoso.com',
    });

    expect(responses).toEqual([{ eventsReceived: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://capi.uet.microsoft.com/v1/97267979/events');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      data: [
        {
          eventType: 'custom',
          eventId: 'event-1',
          eventName: 'purchase',
          eventTime: CREATED_SEC,
          userData: {
            em: 'ec81f3ac7b2b19675bab9d54cf416f9f18cff87c97da5cca82c0f0891bc40602',
            anonymousId: 'v1',
          },
          customData: { value: 42, currency: 'USD', transactionId: 'txn-1' },
        },
      ],
      continueOnValidationError: true,
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('drops page views by default and sends them as pageLoad events on request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pageView = event({
      id: 'pv',
      name: 'page_view',
      properties: {},
      tags: { page_location: 'https://x.test/' },
    });
    const noUrl = event({ id: 'pv-2', name: 'page_view', properties: {}, tags: {} });

    await sendEvents('t', '1', [pageView, noUrl, event({ name: 'scroll', properties: {} })]);
    expect(fetchMock).not.toHaveBeenCalled();

    await sendEvents('t', '1', [pageView, noUrl], {}, { pageLoads: true, dataProvider: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The page view without a URL is skipped rather than rejected by the API.
    expect(body.data.map((e: { eventId: string }) => e.eventId)).toEqual(['pv']);
    expect(body.data[0].eventType).toBe('pageLoad');
    expect(body.dataProvider).toBe('x');
  });

  it('surfaces validation warnings and skipped events that arrive with a 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const details = [{ index: 0, propertyName: 'data[0].userData.em', isWarning: true }];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ eventsReceived: 1, error: { details } }), { status: 200 })
        )
    );
    const responses = await sendEvents('secret-token', '1', [event()]);
    expect(responses[0]?.eventsReceived).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('data[0].userData.em'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret-token');
  });

  it('splits a batch above the API limit into consecutive requests', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const events = Array.from({ length: 1001 }, (_, i) => event({ id: `e-${i}` }));
    const responses = await sendEvents('t', '1', events);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(responses).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data).toHaveLength(1000);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).data).toHaveLength(1);
  });

  it('never throws: an HTTP failure is logged without the token, a network error likewise', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"code":"Unauthorized"}}', { status: 401 }))
    );
    await expect(sendEvents('secret-token', '1', [event()])).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('status: 401'));
    expect(error.mock.calls.flat().join(' ')).not.toContain('secret-token');

    // The shared fetch wrapper retries a network error with backoff; drive the fake clock past it.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const pending = sendEvents('secret-token', '1', [event()]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
  });
});
