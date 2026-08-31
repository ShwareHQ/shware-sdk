// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/checkout"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendGAEvent, setGAUser } from './google-analytics';
import { sendLinkedinEvent, setLinkedinUser } from './linkedin-insight-tag';
import { sendFBEvent, setFBUser } from './meta-pixel';
import { sendRedditEvent, setRedditUser } from './reddit-pixel';

// The senders already declare typed vendor globals on Window; the mocks are cast into them.
const vendor = window as unknown as Record<'fbq' | 'rdt' | 'gtag' | 'lintrk', unknown>;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete vendor.fbq;
  delete vendor.rdt;
  delete vendor.gtag;
  delete vendor.lintrk;
  vi.restoreAllMocks();
});

describe('sendGAEvent', () => {
  it('forwards to gtag when it is present', () => {
    const gtag = vi.fn();
    vendor.gtag = gtag;

    sendGAEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] });
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', expect.objectContaining({ value: 1 }));
  });

  it('warns and returns when gtag never loaded', () => {
    expect(() =>
      sendGAEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] })
    ).not.toThrow();
  });

  it('setGAUser sets each field it is given', () => {
    const gtag = vi.fn();
    vendor.gtag = gtag;

    setGAUser({ user_id: 'u1', tags: {} });
    expect(gtag).toHaveBeenCalledWith('set', 'user_id', 'u1');
    expect(gtag).not.toHaveBeenCalledWith('set', 'user_data', expect.anything());
  });

  it('setGAUser forwards user_data and user_properties when present', () => {
    const gtag = vi.fn();
    vendor.gtag = gtag;

    const user_data = { email: 'a@b.co' };
    setGAUser({ user_data, properties: { plan: 'pro' }, tags: {} });
    expect(gtag).toHaveBeenCalledWith('set', 'user_data', user_data);
    expect(gtag).toHaveBeenCalledWith('set', 'user_properties', { plan: 'pro' });
  });
});

describe('sendFBEvent', () => {
  it('maps a standard event and passes the event id for deduplication', () => {
    const fbq = vi.fn();
    vendor.fbq = fbq;

    sendFBEvent(
      'purchase',
      { value: 9, currency: 'USD', transaction_id: 't1', items: [] },
      'event-1'
    );

    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', expect.objectContaining({ value: 9 }), {
      eventID: 'event-1',
    });
  });

  it('sends unknown names through trackCustom', () => {
    const fbq = vi.fn();
    vendor.fbq = fbq;

    sendFBEvent('my_custom', { a: 1 }, 'event-2');
    expect(fbq).toHaveBeenCalledWith('trackCustom', 'my_custom', { a: 1 }, { eventID: 'event-2' });
  });

  it('drops web vitals instead of forwarding them', () => {
    const fbq = vi.fn();
    vendor.fbq = fbq;

    sendFBEvent('CLS', { value: 0.02 });
    expect(fbq).not.toHaveBeenCalled();
  });

  it('does not throw where the pixel never loaded', () => {
    expect(() =>
      sendFBEvent('purchase', { value: 9, currency: 'USD', transaction_id: 't1', items: [] })
    ).not.toThrow();
  });

  it('setFBUser re-inits the pixel with advanced matching, st carrying the region', () => {
    const fbq = vi.fn();
    vendor.fbq = fbq;

    setFBUser('123')({
      user_id: 'u1',
      user_data: {
        email: ['ada@example.com', 'second@example.com'],
        phone_number: '+14155551234',
        address: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          city: 'London',
          region: 'ENG',
          street: '12 Analytical Way',
          postal_code: 'SW1',
          country: 'GB',
        },
      },
      tags: {},
    });

    expect(fbq).toHaveBeenCalledWith('init', '123', {
      em: 'ada@example.com', // first of the list
      fn: 'Ada',
      ln: 'Lovelace',
      ph: '+14155551234',
      external_id: 'u1',
      ct: 'London',
      st: 'ENG', // the state field must not carry the street address
      zp: 'SW1',
      country: 'GB',
    });
  });
});

describe('sendRedditEvent', () => {
  it('tracks with the mapped type', () => {
    const rdt = vi.fn();
    vendor.rdt = rdt;

    sendRedditEvent(
      'purchase',
      { value: 9, currency: 'usd', transaction_id: 't1', items: [] },
      'event-1'
    );
    expect(rdt).toHaveBeenCalledWith(
      'track',
      'Purchase',
      expect.objectContaining({ conversionId: 'event-1', currency: 'USD' })
    );
  });

  it('strips undefined values before handing params to the pixel', () => {
    const rdt = vi.fn();
    vendor.rdt = rdt;

    sendRedditEvent(
      'purchase',
      { value: 9, currency: 'usd', transaction_id: 't1', items: [] },
      'event-1'
    );
    const params = rdt.mock.calls[0][2];
    expect(Object.values(params)).not.toContain(undefined);
  });

  it('sends an unknown name as a Custom event', () => {
    const rdt = vi.fn();
    vendor.rdt = rdt;

    sendRedditEvent('started_trial', { value: 5, currency: 'usd' }, 'event-3');
    expect(rdt).toHaveBeenCalledWith(
      'track',
      'Custom',
      expect.objectContaining({ customEventName: 'started_trial', conversionId: 'event-3' })
    );
  });

  it('setRedditUser re-inits with the first email and the external id', () => {
    const rdt = vi.fn();
    vendor.rdt = rdt;

    setRedditUser('a2_pixel')({
      user_id: 'u1',
      user_data: { email: ['ada@example.com', 'x@y.z'], phone_number: '+14155551234' },
      tags: {},
    });

    expect(rdt).toHaveBeenCalledWith('init', 'a2_pixel', {
      email: 'ada@example.com',
      phoneNumber: '+14155551234',
      externalId: 'u1',
    });
  });
});

describe('sendLinkedinEvent', () => {
  it('fires only for conversions in the config, by conversion id', () => {
    const lintrk = vi.fn();
    vendor.lintrk = lintrk;
    const send = sendLinkedinEvent({ purchase: 123 });

    send('purchase', { value: 9, currency: 'USD', transaction_id: 't1', items: [] }, 'event-1');
    send('sign_up', { method: 'email' }, 'event-2');

    expect(lintrk).toHaveBeenCalledTimes(1);
    expect(lintrk).toHaveBeenCalledWith('track', { conversion_id: 123, event_id: 'event-1' });
  });

  it('setLinkedinUser sends the email, and nothing without one', () => {
    const lintrk = vi.fn();
    vendor.lintrk = lintrk;

    setLinkedinUser({ user_id: 'u1', tags: {} });
    expect(lintrk).not.toHaveBeenCalled();

    setLinkedinUser({ user_data: { email: 'ada@example.com' }, tags: {} });
    expect(lintrk).toHaveBeenCalledWith('setUserData', { email: 'ada@example.com' });
  });
});

describe('user setters before the vendor script loads', () => {
  it('every setter warns and returns instead of throwing', () => {
    expect(() => setFBUser('123')({ user_id: 'u1', tags: {} })).not.toThrow();
    expect(() => setRedditUser('a2_p')({ user_id: 'u1', tags: {} })).not.toThrow();
    expect(() => setLinkedinUser({ user_data: { email: 'a@b.co' }, tags: {} })).not.toThrow();
    expect(() => setGAUser({ user_id: 'u1', tags: {} })).not.toThrow();
  });
});

describe('localhost', () => {
  it('the ad pixels stay silent during local development', () => {
    const fbq = vi.fn();
    vendor.fbq = fbq;
    const original = window.location.href;
    // jsdom lets tests navigate; the guard reads window.location.host.
    window.history.replaceState(null, '', '/');
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost:3000/'),
      configurable: true,
    });

    sendFBEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] });
    expect(fbq).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { value: new URL(original), configurable: true });
  });
});

describe('server rendering', () => {
  it('every sender returns without touching the vendor global', async () => {
    // Simulated SSR: no window, no document. The functions must all guard before dereferencing.
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    try {
      expect(() =>
        sendGAEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] })
      ).not.toThrow();
      expect(() => setGAUser({ user_id: 'u', tags: {} })).not.toThrow();
      expect(() =>
        sendFBEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] })
      ).not.toThrow();
      expect(() =>
        sendRedditEvent('purchase', { value: 1, currency: 'usd', transaction_id: 't1', items: [] })
      ).not.toThrow();
      expect(() => sendLinkedinEvent({ purchase: 1 })('purchase', undefined, 'e')).not.toThrow();

      const { sendPosthogEvent } = await import('./posthog');
      expect(() =>
        sendPosthogEvent('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] })
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
