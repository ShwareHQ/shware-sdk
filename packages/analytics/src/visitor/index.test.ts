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

  it('tells the third-party setters at once', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, config } = await load();
    config.thirdPartyUserSetters = [setter];
    const user_data = { email: 'a@b.co' };

    identify('u1', user_data);

    expect(setter).toHaveBeenCalledWith({ user_id: 'u1', user_data });
  });

  it("identifies the same user again on the new visitor another tab's reset left", async () => {
    const { identify, storage, IDENTIFY_EVENT } = await load({ visitor_id: 'visitor-a' });

    identify('a');
    // Another tab signed out and back in: the shared storage holds a new visitor, no user yet.
    storage.map.set('visitor_id', 'visitor-b');
    storage.map.set('user_id', '');
    identify('a');

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'a' },
      { enableThirdPartyTracking: false }
    );
    // A new visitor under the same user is not another user: nothing to reset.
    expect(endSession).not.toHaveBeenCalled();
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
    expect(setter.mock.calls.map(([user]) => user.user_id)).toEqual([undefined, 'b']);
  });

  it('still identifies when the storage throws', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, storage, config, IDENTIFY_EVENT } = await load();
    config.thirdPartyUserSetters = [setter];
    storage.getItem = () => {
      throw new Error('storage unavailable');
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => identify('u1')).not.toThrow();
    expect(track).toHaveBeenCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'u1' },
      { enableThirdPartyTracking: false }
    );
    expect(setter).toHaveBeenCalledWith({ user_id: 'u1', user_data: undefined });
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
    const { reset, storage, config } = await load({ visitor_id: 'visitor-a', user_id: 'a' });
    config.thirdPartyUserSetters = [setter];

    reset();

    // Ending the session (reporting it, clearing it) is the queue's: see track/index.test.ts.
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(storage.map.get('visitor_id')).not.toBe('visitor-a');
    expect(storage.map.get('visitor_id')).toMatch(uuidv7);
    expect(storage.map.get('user_id')).toBe('');
    expect(setter).toHaveBeenCalledWith({});
  });

  it('keeps what describes the device', async () => {
    const seed = {
      user_id: 'a',
      device_id: 'device-1',
      first_visit_time: '2026-01-01T00:00:00.000Z',
    };
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
    const { reset, config } = await load({ user_id: 'a' });
    config.thirdPartyUserSetters = [setter];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => reset()).not.toThrow();
    expect(setter).toHaveBeenCalledWith({});
  });

  it('replaces the visitor once per sign-out, however many tabs call it', async () => {
    const { reset, storage } = await load({ visitor_id: 'visitor-a', user_id: 'a' });

    reset(); // the tab that signed out
    const anonymous = storage.map.get('visitor_id');
    reset(); // another tab, finding the account gone when it is focused

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(storage.map.get('visitor_id')).toBe(anonymous);
  });

  it("leaves the next user's binding alone when a stale sign-out comes in after it", async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, reset, storage, config } = await load({ visitor_id: 'visitor-1' });
    config.thirdPartyUserSetters = [setter];
    identify('a');
    // Meanwhile another tab signed A out and B in: a new visitor, bound to B.
    storage.map.set('visitor_id', 'visitor-2');
    storage.map.set('user_id', 'b');

    reset(); // this tab, frozen in the background, only now handles A's sign-out

    expect(endSession).not.toHaveBeenCalled();
    expect(storage.map.get('visitor_id')).toBe('visitor-2');
    expect(storage.map.get('user_id')).toBe('b');
    // This page still drops the user it told GA about.
    expect(setter).toHaveBeenLastCalledWith({});

    // Handled twice (a second listener, a second notice): signed out here already, still stale.
    setter.mockClear();
    reset();
    expect(endSession).not.toHaveBeenCalled();
    expect(storage.map.get('visitor_id')).toBe('visitor-2');
    expect(storage.map.get('user_id')).toBe('b');
    expect(setter).not.toHaveBeenCalled();
  });

  it('signs the same user in and out again on a page that signed out before', async () => {
    const { identify, reset, storage, IDENTIFY_EVENT } = await load({ visitor_id: 'visitor-1' });
    identify('a');
    reset();
    const anonymous = storage.map.get('visitor_id');

    identify('a');
    expect(track).toHaveBeenLastCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'a' },
      { enableThirdPartyTracking: false }
    );
    reset();

    expect(endSession).toHaveBeenCalledTimes(2);
    expect(storage.map.get('visitor_id')).not.toBe(anonymous);
    expect(storage.map.get('user_id')).toBe('');
  });

  it('still takes the user back from the setters of a page that identified one', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { identify, reset, storage, config } = await load();
    config.thirdPartyUserSetters = [setter];
    identify('a');
    // Another tab has reset since: the device no longer has a user, but this page told GA one.
    storage.map.set('user_id', '');
    const visitor = storage.map.get('visitor_id');

    reset();

    expect(endSession).not.toHaveBeenCalled();
    expect(storage.map.get('visitor_id')).toBe(visitor);
    expect(setter).toHaveBeenLastCalledWith({});
  });

  it('does nothing on a device nobody signed in on', async () => {
    const setter = vi.fn<ThirdPartyUserSetter>();
    const { reset, storage, config } = await load({ visitor_id: 'visitor-a' });
    config.thirdPartyUserSetters = [setter];

    reset();

    expect(endSession).not.toHaveBeenCalled();
    expect(storage.map.get('visitor_id')).toBe('visitor-a');
    expect(setter).not.toHaveBeenCalled();
  });
});
