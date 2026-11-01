import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textRequestBody } from '../test/setup';
import { metaAds } from '../third-parties/meta-pixel';
import { microsoftAds } from '../third-parties/microsoft-uet';
import { redditAds } from '../third-parties/reddit-pixel';
import type { TrackEvent, UserProvidedData } from '../track/types';
import { linkedinConversions } from './linkedin-conversions-api';
import { metaConversions } from './meta-capi';
import { microsoftConversions } from './microsoft-conversions-api';
import { redditConversions } from './reddit-conversions-api';
import {
  type ConversionDestination,
  type ConversionUser,
  type ConversionsOptions,
  setupConversions,
} from './setup-conversions';

const fetchMock = vi.fn<typeof globalThis.fetch>();

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function event(name: string, id = name): TrackEvent<any> {
  return {
    id,
    name,
    tags: {},
    visitor_id: 'v1',
    session_id: 's1',
    platform: 'web',
    environment: 'production',
    created_at: new Date().toISOString(),
  };
}

/**
 * The ids of the events each request carried, request by request. The test events' ids are their
 * names, so these are the names a destination sent.
 */
function sentIds(read: (body: never) => string[]) {
  return fetchMock.mock.calls.map(([, init]) => read(JSON.parse(textRequestBody(init)) as never));
}
const metaIds = (body: { data: { event_id: string }[] }) => body.data.map((e) => e.event_id);
const redditIds = (body: { data: { events: { metadata: { conversion_id: string } }[] } }) =>
  body.data.events.map((e) => e.metadata.conversion_id);
const microsoftIds = (body: { data: { eventId: string }[] }) => body.data.map((e) => e.eventId);
const linkedinIds = (body: { elements: { eventId: string }[] }) =>
  body.elements.map((e) => e.eventId);

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the destinations send what the browser integrations send', () => {
  const names = ['purchase', 'sign_up', 'add_to_cart', 'onboarding_completed', 'button_clicked'];

  /** The names a browser integration lets through: it calls its pixel only for those. */
  function browserAccepts(track: (name: never) => unknown) {
    const accepted: string[] = [];
    vi.stubGlobal('window', {
      location: { host: 'shop.example' },
      fbq: () => accepted.push('fbq'),
      rdt: () => accepted.push('rdt'),
      uetq: { push: () => accepted.push('uetq') },
    });
    const result = names.filter((name) => {
      const before = accepted.length;
      track(name as never);
      return accepted.length > before;
    });
    // Only `window`: `fetch` stays stubbed for the requests after.
    vi.stubGlobal('window', undefined);
    return result;
  }

  it('Meta: its standard events and customEvents', async () => {
    const ads = { pixelId: '123' as const, customEvents: ['onboarding_completed'] as const };
    await metaConversions({ ...ads, accessToken: 't' }).send(
      names.map((n) => event(n)),
      {}
    );
    expect(sentIds(metaIds)).toEqual([browserAccepts(metaAds(ads).track)]);
    expect(sentIds(metaIds)[0]).not.toContain('button_clicked');
  });

  it('Reddit: its standard events and customEvents', async () => {
    const ads = { pixelId: 'a2_x' as const, customEvents: ['onboarding_completed'] as const };
    await redditConversions({ ...ads, accessToken: 't' }).send(
      names.map((n) => event(n)),
      {}
    );
    expect(sentIds(redditIds)).toEqual([browserAccepts(redditAds(ads).track)]);
  });

  it('Microsoft: `events` and customEvents, and page_view only with pageLoads', async () => {
    const ads = {
      tagId: '1' as const,
      events: ['purchase'] as const,
      customEvents: ['sign_up'] as const,
    };
    await microsoftConversions({ ...ads, accessToken: 't' }).send(
      names.map((n) => event(n)),
      {}
    );
    expect(sentIds(microsoftIds)).toEqual([browserAccepts(microsoftAds(ads).track)]);

    fetchMock.mockClear();
    const withPageLoads = microsoftConversions({ ...ads, accessToken: 't', pageLoads: true });
    // A page load is sent only with its page's URL.
    const pageView = { ...event('page_view'), tags: { page_location: 'https://shop.example/' } };
    await withPageLoads.send([pageView, event('button_clicked')], {});
    expect(sentIds(microsoftIds)).toEqual([['page_view']]);
  });

  it('LinkedIn: the events with a conversion id', async () => {
    const send = linkedinConversions({ accessToken: 't', conversions: { purchase: 1 } }).send;
    await send([event('purchase'), event('sign_up')], { user_id: 'u1' });
    expect(sentIds(linkedinIds)).toEqual([['purchase']]);
  });

  it('makes no request when nothing is left', async () => {
    await metaConversions({ pixelId: '123', accessToken: 't' }).send([event('button_clicked')], {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('forward', () => {
  it('hands the events and the user to every destination', async () => {
    const a = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const b = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const data: UserProvidedData = { user_id: 'u1' };
    await setupConversions({ destinations: [a, b] }).forward([event('purchase')], data);
    expect(a.send).toHaveBeenCalledWith([expect.objectContaining({ name: 'purchase' })], data);
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it('logs a destination that failed, with the events it lost, and sends to the others', async () => {
    const down = new Error('down');
    const failing = { send: () => Promise.reject(down) };
    const working = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const { forward } = setupConversions({ destinations: [failing, working] });

    await expect(
      forward([event('purchase', 'e1'), event('sign_up', 'e2')])
    ).resolves.toBeUndefined();
    expect(working.send).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Conversions not sent, events: e1, e2', down);
  });

  it('a destination that throws synchronously stops neither the others nor forward', async () => {
    const throwing = {
      send: () => {
        throw new Error('sync');
      },
    };
    const working = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const { forward } = setupConversions({ destinations: [throwing, working] });
    await expect(forward([event('purchase')])).resolves.toBeUndefined();
    expect(working.send).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an empty batch', async () => {
    const destination = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    await setupConversions({ destinations: [destination] }).forward([]);
    expect(destination.send).not.toHaveBeenCalled();
  });
});

describe('track', () => {
  const user: ConversionUser = {
    tags: { _fbp: 'fb.1.1.42', fbclid: 'CLICK' },
    visitor_id: 'v9',
    session_id: 's9',
    platform: 'ios',
    environment: 'production',
    data: { user_id: 'u1', email: 'a@b.co' },
  };
  const purchase = {
    id: 'txn-1',
    name: 'purchase' as const,
    userId: 'u1',
    properties: { transaction_id: 'txn-1', value: 9.99, currency: 'usd', items: [] },
    createdAt: '2026-11-01T00:00:00.000Z',
  };

  function setup(overrides: Partial<NonNullable<ConversionsOptions['track']>> = {}) {
    const destination = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const conversions = setupConversions({
      destinations: [destination],
      track: { resolveUser: () => Promise.resolve(user), ...overrides },
    });
    return { destination, ...conversions };
  }

  it("completes the event from the user's session and forwards it with their data", async () => {
    const { destination, track } = setup();
    const event = await track(purchase);

    expect(event).toEqual({
      id: 'txn-1',
      name: 'purchase',
      properties: purchase.properties,
      tags: user.tags,
      visitor_id: 'v9',
      session_id: 's9',
      platform: 'ios',
      environment: 'production',
      created_at: '2026-11-01T00:00:00.000Z',
    });
    expect(destination.send).toHaveBeenCalledWith([event], user.data);
  });

  it('happened now unless told otherwise', async () => {
    const before = Date.now();
    const event = await setup().track({ ...purchase, createdAt: undefined });
    expect(Date.parse(event?.created_at ?? '')).toBeGreaterThanOrEqual(before);
  });

  it('stores the event before sending it', async () => {
    const order: string[] = [];
    const store = vi.fn<(e: TrackEvent) => Promise<boolean>>(async () => {
      order.push('store');
      return true;
    });
    const { destination, track } = setup({ store });
    destination.send.mockImplementation(async () => {
      order.push('send');
    });
    const event = await track(purchase);
    expect(store).toHaveBeenCalledWith(event);
    expect(order).toEqual(['store', 'send']);
  });

  it('sends only an event store stored, so a redelivered webhook is not reported twice', async () => {
    const stored = new Set<string>();
    const store = vi.fn<(e: TrackEvent) => Promise<boolean>>(async (e) => {
      const fresh = !stored.has(e.id);
      stored.add(e.id);
      return fresh;
    });
    const { destination, track } = setup({ store });

    await expect(track(purchase)).resolves.toBeDefined();
    await expect(track(purchase)).resolves.toBeUndefined();
    expect(store).toHaveBeenCalledTimes(2);
    expect(destination.send).toHaveBeenCalledTimes(1);
  });

  it('never fails the webhook: a destination that failed is logged with the event id', async () => {
    const { destination, track } = setup();
    destination.send.mockRejectedValueOnce(new Error('platform down'));
    await expect(track(purchase)).resolves.toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith('Conversions not sent, events: txn-1', expect.any(Error));
  });

  it('sends nothing for a user with no session, and resolves undefined', async () => {
    const store = vi.fn<(e: TrackEvent) => Promise<boolean>>(() => Promise.resolve(true));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { destination, track } = setup({ resolveUser: () => Promise.resolve(undefined), store });
    await expect(track(purchase)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('txn-1'));
    expect(store).not.toHaveBeenCalled();
    expect(destination.send).not.toHaveBeenCalled();
  });

  it('logs a failing lookup or store, sends nothing, and does not throw', async () => {
    const lookup = setup({ resolveUser: () => Promise.reject(new Error('db down')) });
    await expect(lookup.track(purchase)).resolves.toBeUndefined();
    expect(lookup.destination.send).not.toHaveBeenCalled();

    const storing = setup({ store: () => Promise.reject(new Error('insert failed')) });
    await expect(storing.track(purchase)).resolves.toBeUndefined();
    expect(storing.destination.send).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Conversion not reported, event: txn-1',
      expect.any(Error)
    );
  });

  it('needs the track option', async () => {
    const destination = { send: vi.fn<ConversionDestination['send']>(() => Promise.resolve()) };
    const { track } = setupConversions({ destinations: [destination] });
    await expect(track(purchase)).resolves.toBeUndefined();
    expect(destination.send).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('track option'));
  });
});
