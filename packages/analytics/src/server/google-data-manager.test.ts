import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackEvent } from '../track/types';
import { getDataManagerEvent, normalizeEmail, sendEvents } from './google-data-manager';

const CREATED_AT = '2026-01-10T12:34:56.000Z';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function event(partial: Partial<TrackEvent<any>> = {}): TrackEvent<any> {
  return {
    id: 'event-1',
    name: 'purchase',
    tags: { gclid: 'G123' },
    visitor_id: 'v1',
    session_id: 's1',
    platform: 'web',
    environment: 'production',
    properties: { value: 42.5, currency: 'usd', transaction_id: 'T-1', items: [] },
    created_at: CREATED_AT,
    ...partial,
  };
}

const config = { purchase: 111, sign_up: '222' } as const;

describe('normalizeEmail', () => {
  it('strips dots and plus suffixes for gmail only', () => {
    expect(normalizeEmail(' First.Last+tag@Gmail.com ')).toBe('firstlast@gmail.com');
    expect(normalizeEmail('first.last@googlemail.com')).toBe('firstlast@googlemail.com');
    expect(normalizeEmail('First.Last+tag@company.com')).toBe('first.last+tag@company.com');
  });
});

describe('getDataManagerEvent', () => {
  it('builds the event, timed by created_at and matched by the transaction id', () => {
    expect(getDataManagerEvent(event(), config)).toEqual({
      destinationReferences: ['111'],
      transactionId: 'T-1',
      eventTimestamp: CREATED_AT,
      eventSource: 'WEB',
      conversionValue: 42.5,
      currency: 'USD',
      adIdentifiers: { gclid: 'G123' },
    });
  });

  it('sends at most one click id, preferring gclid, then gbraid', () => {
    const both = getDataManagerEvent(
      event({ tags: { gclid: 'G', gbraid: 'B', wbraid: 'W' } }),
      config
    );
    expect(both?.adIdentifiers).toEqual({ gclid: 'G' });

    const ios = getDataManagerEvent(event({ tags: { gbraid: 'B', wbraid: 'W' } }), config);
    expect(ios?.adIdentifiers).toEqual({ gbraid: 'B' });
  });

  it('skips an unconfigured event, and one with nothing to match on', () => {
    expect(getDataManagerEvent(event({ name: 'page_view' }), config)).toBeUndefined();
    expect(getDataManagerEvent(event({ tags: {} }), config)).toBeUndefined();
  });

  it('keeps a click-id-less event that carries user identifiers', () => {
    const out = getDataManagerEvent(event({ tags: {} }), config, { email: 'a@b.co' });
    expect(out?.adIdentifiers).toBeUndefined();
    expect(out?.userData?.userIdentifiers).toEqual([{ emailAddress: sha('a@b.co') }]);
  });

  it('defaults value, currency, and transaction id for a bare conversion', () => {
    const out = getDataManagerEvent(event({ name: 'sign_up', properties: {} }), config);
    expect(out).toMatchObject({
      destinationReferences: ['222'],
      transactionId: 'event-1',
      conversionValue: 0,
      currency: 'USD',
    });
  });

  it('falls back to USD for a currency the fast-fail API would reject', () => {
    const out = getDataManagerEvent(
      event({ properties: { value: 1, currency: 'US Dollars', transaction_id: 'T', items: [] } }),
      config
    );
    expect(out?.currency).toBe('USD');
  });

  it('maps platform to eventSource', () => {
    expect(getDataManagerEvent(event({ platform: 'ios' }), config)?.eventSource).toBe('APP');
    expect(getDataManagerEvent(event({ platform: 'unknown' }), config)?.eventSource).toBe('OTHER');
  });

  it('hashes identifiers with Google email normalization, capped at ten', () => {
    const out = getDataManagerEvent(event(), config, {
      email: 'First.Last@gmail.com',
      phone_number: '+15551234567',
    });
    expect(out?.userData?.userIdentifiers).toEqual([
      { emailAddress: sha('firstlast@gmail.com') },
      { phoneNumber: sha('+15551234567') },
    ]);

    const many = getDataManagerEvent(event(), config, {
      email: Array.from({ length: 8 }, (_, i) => `u${i}@x.co`),
      phone_number: ['+15550000001', '+15550000002', '+15550000003'],
    });
    expect(many?.userData?.userIdentifiers).toHaveLength(10);
  });
});

describe('sendEvents', () => {
  const fetchMock = vi.fn();
  const auth = {
    accessToken: 'oauth-token',
    operatingAccountId: '123-456-7890',
    loginAccountId: '999-888-7777',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{"requestId":"r-1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ingests with one destination per action, credentials in headers only', async () => {
    const result = await sendEvents(auth, config, [
      event(),
      event({ id: 'event-2', name: 'sign_up', properties: {} }),
    ]);

    expect(result?.requestId).toBe('r-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://datamanager.googleapis.com/v1/events:ingest');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer oauth-token' });
    const body = JSON.parse(init.body as string);
    expect(body.destinations).toEqual([
      {
        reference: '111',
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' },
        loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9998887777' },
        productDestinationId: '111',
      },
      {
        reference: '222',
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' },
        loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9998887777' },
        productDestinationId: '222',
      },
    ]);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].destinationReferences).toEqual(['111']);
    expect(body.events[1].destinationReferences).toEqual(['222']);
    expect(body.validateOnly).toBe(false);
    expect(body.encoding).toBeUndefined();
  });

  it('declares HEX encoding only when identifiers are present', async () => {
    await sendEvents(auth, config, [event()], { email: 'a@b.co' });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.encoding).toBe('HEX');
  });

  it('sends nothing when no event is uploadable', async () => {
    await sendEvents(auth, config, [
      event({ tags: {} }), // nothing to match on
      event({ name: 'scroll' }), // ignored event
      event({ name: 'my_custom' }), // not configured
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards request-level consent and validateOnly', async () => {
    await sendEvents(
      auth,
      config,
      [event()],
      {},
      { validateOnly: true, consent: { adUserData: 'CONSENT_GRANTED' } }
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.validateOnly).toBe(true);
    expect(body.consent).toEqual({ adUserData: 'CONSENT_GRANTED' });
  });

  it('never throws on a rejected request or a network failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(sendEvents(auth, config, [event()])).resolves.toBeUndefined();

    // The @shware/utils fetch wrapper retries transient failures, so fail every attempt.
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await expect(sendEvents(auth, config, [event()])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('splits a batch beyond the 2000-event request cap into sequential requests', async () => {
    const events = Array.from({ length: 2001 }, (_, i) => event({ id: `event-${i}` }));
    await sendEvents(auth, config, events);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(first.events).toHaveLength(2000);
    expect(second.events).toHaveLength(1);
  });

  it('omits loginAccount when access is not delegated', async () => {
    await sendEvents({ accessToken: 't', operatingAccountId: '123' }, config, [event()]);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.destinations[0].loginAccount).toBeUndefined();
  });
});
