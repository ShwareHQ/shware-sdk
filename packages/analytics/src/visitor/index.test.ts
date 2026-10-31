import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Track from '../track/index';
import type { ThirdPartyUserSetter } from './types';

const fetchMock = vi.fn<typeof globalThis.fetch>();
const { track, endSession } = vi.mockObject<Pick<typeof Track, 'track' | 'endSession'>>({
  track() {},
  endSession() {},
});
vi.mock<Pick<typeof Track, 'track' | 'endSession'>>(import('../track/index'), () => ({
  track,
  endSession,
}));

async function load(seed: Record<string, string> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage(seed);
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage }));
  const visitor = await import('./index');
  return { storage, cache: setup.cache, config: setup.config, jsonResponse, ...visitor };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  track.mockReset();
  endSession.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('visitorId', () => {
  it('generates a uuidv7 on the first visit and keeps it, without a request', async () => {
    const { visitorId, storage } = await load();

    const id = visitorId();

    expect(id).toMatch(uuidv7);
    expect(storage.map.get('visitor_id')).toBe(id);
    expect(visitorId()).toBe(id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an id a server issued to an older client', async () => {
    const { visitorId } = await load({ visitor_id: '0199e7a0-0000-7000-8000-000000000001' });
    expect(visitorId()).toBe('0199e7a0-0000-7000-8000-000000000001');
  });

  it("replaces a stored 'undefined' with a new id, in storage too", async () => {
    const { visitorId, storage } = await load({ visitor_id: 'undefined' });

    const id = visitorId();

    expect(id).toMatch(uuidv7);
    expect(storage.map.get('visitor_id')).toBe(id);
    expect(visitorId()).toBe(id);
  });
});

describe('identify', () => {
  it('identifies the user once per page, and again only for another user', async () => {
    const { identify, IDENTIFY_EVENT } = await load();

    identify('u1');
    identify('u1'); // the host calls it on every page load and auth event
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'u1' },
      { enableThirdPartyTracking: false }
    );

    identify('u2');
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'u2' },
      { enableThirdPartyTracking: false }
    );
    // No request of its own: the binding rides on the events.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells the third-party setters at once, with the user as the distinct id', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, config } = await load();
    config.thirdPartyUserSetters = [setter];
    const user_data = { email: 'a@b.co' };

    identify('u1', user_data);

    expect(setter).toHaveBeenCalledWith({ user_id: 'u1', user_data, distinct_id: 'u1' });
  });

  it('remembers the user on this device, and keeps the visitor for the same user', async () => {
    const { identify, storage } = await load({ visitor_id: 'visitor-a', user_id: 'a' });

    identify('a');

    expect(storage.map.get('user_id')).toBe('a');
    expect(storage.map.get('visitor_id')).toBe('visitor-a');
    expect(endSession).not.toHaveBeenCalled();
  });

  it('resets first when another user signs in over the one last identified here', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, storage, config } = await load({ visitor_id: 'visitor-a', user_id: 'a' });
    config.thirdPartyUserSetters = [setter];

    identify('b');

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(storage.map.get('visitor_id')).not.toBe('visitor-a');
    expect(storage.map.get('visitor_id')).toMatch(uuidv7);
    expect(storage.map.get('user_id')).toBe('b');
    // PostHog is reset before it is identified as the new user.
    expect(setter.mock.calls.map(([identity]) => identity.distinct_id)).toEqual([null, 'b']);
  });

  it('never throws: a setter that throws does not stop the others', async () => {
    const bad = vi.fn<ThirdPartyUserSetter>(() => {
      throw new Error('pixel not loaded');
    });
    const good = vi.fn<ThirdPartyUserSetter>();
    const { identify, config } = await load();
    config.thirdPartyUserSetters = [bad, good];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => identify('u1')).not.toThrow();
    expect(good).toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });
});

describe('reset', () => {
  it('ends the session, starts a new visitor and forgets the user', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { reset, storage, config } = await load({
      visitor_id: 'visitor-a',
      user_id: 'a',
      session: `1.session-a.${Date.now()}`,
    });
    config.thirdPartyUserSetters = [setter];

    reset();

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(storage.map.get('session')).toBe('');
    expect(storage.map.get('visitor_id')).not.toBe('visitor-a');
    expect(storage.map.get('visitor_id')).toMatch(uuidv7);
    expect(storage.map.get('user_id')).toBe('');
    expect(setter).toHaveBeenCalledWith({ distinct_id: null });
  });

  it('keeps what describes the device', async () => {
    const seed = { device_id: 'device-1', first_visit_time: '2026-01-01T00:00:00.000Z' };
    const { reset, storage } = await load(seed);

    reset();

    expect(storage.map.get('device_id')).toBe('device-1');
    expect(storage.map.get('first_visit_time')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('lets the same user signing back in be identified again', async () => {
    const { identify, reset, IDENTIFY_EVENT } = await load();

    identify('a');
    reset();
    identify('a');

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'a' },
      { enableThirdPartyTracking: false }
    );
    // Signing back in after a reset is not a different user: no second reset.
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when ending the session does', async () => {
    endSession.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { reset, config } = await load();
    config.thirdPartyUserSetters = [setter];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => reset()).not.toThrow();
    expect(setter).toHaveBeenCalledWith({ distinct_id: null });
  });
});
