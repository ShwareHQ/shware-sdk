import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const track = vi.fn();
vi.mock('../track/index', () => ({ track }));

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

  it("does not take a stored 'undefined' for an id", async () => {
    const { visitorId } = await load({ visitor_id: 'undefined' });
    expect(visitorId()).toMatch(uuidv7);
  });
});

describe('setVisitor', () => {
  it('identifies the user once per page, and again only for another user', async () => {
    const { setVisitor, IDENTIFY_EVENT } = await load();

    setVisitor({ user_id: 'u1' });
    setVisitor({ user_id: 'u1' }); // the host calls it on every page load and auth event
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      IDENTIFY_EVENT,
      { user_id: 'u1' },
      { enableThirdPartyTracking: false }
    );

    setVisitor({ user_id: 'u2' });
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
    const setter = vi.fn();
    const { setVisitor, config } = await load();
    config.thirdPartyUserSetters = [setter];
    const user_data = { email: 'a@b.co' };

    setVisitor({ user_id: 'u1', user_data });

    expect(setter).toHaveBeenCalledWith({ user_id: 'u1', user_data, distinct_id: 'u1' });
  });

  it('identifies nobody without a user id, and still hands user_data to the setters', async () => {
    const setter = vi.fn();
    const { setVisitor, config } = await load();
    config.thirdPartyUserSetters = [setter];

    setVisitor({ user_data: { email: 'a@b.co' } });

    expect(track).not.toHaveBeenCalled();
    expect(setter).toHaveBeenCalledWith({ user_data: { email: 'a@b.co' }, distinct_id: null });
  });

  it('never throws: a setter that throws does not stop the others', async () => {
    const bad = vi.fn(() => {
      throw new Error('pixel not loaded');
    });
    const good = vi.fn();
    const { setVisitor, config } = await load();
    config.thirdPartyUserSetters = [bad, good];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => setVisitor({ user_id: 'u1' })).not.toThrow();
    expect(good).toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
