import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

async function load(seed: Record<string, string> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage(seed);
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage }));
  const visitor = await import('./index');
  return { storage, cache: setup.cache, config: setup.config, jsonResponse, ...visitor };
}

function calls() {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit];
    return { url, method: init.method };
  });
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function body(call = 0) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

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
  it('PATCHes the visitor and notifies the third-party setters', async () => {
    const setter = vi.fn();
    const { setVisitor, visitorId, config, jsonResponse } = await load();
    config.thirdPartyUserSetters = [setter];
    fetchMock.mockResolvedValue(jsonResponse({ id: 'v1', user_id: 'u1', distinct_id: 'u1' }));

    await setVisitor({ user_id: 'u1' });

    // Under the local id.
    expect(calls()).toEqual([{ url: `https://api.test/visitors/${visitorId()}`, method: 'PATCH' }]);
    expect(body()).toMatchObject({ user_id: 'u1', tags: expect.any(Object) });
    // The setter is told the server's distinct_id, not anything the client sent.
    expect(setter).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', distinct_id: 'u1' })
    );
  });

  it('a throwing setter does not reject a PATCH that already succeeded', async () => {
    const bad = vi.fn(() => {
      throw new Error('pixel not loaded');
    });
    const good = vi.fn();
    const { setVisitor, config, jsonResponse } = await load();
    config.thirdPartyUserSetters = [bad, good];
    fetchMock.mockResolvedValue(jsonResponse({ id: 'v1', user_id: 'u1' }));

    await expect(setVisitor({ user_id: 'u1' })).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
  });

  it('throws when the PATCH fails', async () => {
    const { setVisitor, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse('nope', 400));

    await expect(setVisitor({ user_id: 'u1' })).rejects.toThrow('Failed to set visitor');
  });
});
