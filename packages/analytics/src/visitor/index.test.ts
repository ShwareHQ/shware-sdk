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

describe('getVisitor', () => {
  it('creates a visitor when nothing is stored, and persists the id', async () => {
    const { getVisitor, storage, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'new-visitor' }));

    const visitor = await getVisitor();

    expect(visitor.id).toBe('new-visitor');
    expect(storage.map.get('visitor_id')).toBe('new-visitor');
    expect(calls()[0]).toMatchObject({ url: 'https://api.test/visitors', method: 'POST' });
  });

  it('refreshes a stored visitor with a PATCH carrying the current tags', async () => {
    const { getVisitor, jsonResponse } = await load({ visitor_id: 'stored-visitor' });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'stored-visitor' }));

    await getVisitor();

    expect(calls()[0]).toMatchObject({
      url: 'https://api.test/visitors/stored-visitor',
      method: 'PATCH',
    });
  });

  it('caches after the first resolution and coalesces concurrent callers', async () => {
    const { getVisitor, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'v' }));

    await Promise.all([getVisitor(), getVisitor()]);
    await getVisitor();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recreates the visitor when the PATCH is rejected', async () => {
    const { getVisitor, jsonResponse } = await load({ visitor_id: 'legacy-int64-id' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'bad id' }, 400))
      .mockResolvedValueOnce(jsonResponse({ id: 'replacement' }));

    const visitor = await getVisitor();

    expect(visitor.id).toBe('replacement');
    expect(calls().map((c) => c.method)).toEqual(['PATCH', 'POST']);
  });

  it('a failed request does not disable tracking for the page', async () => {
    const { getVisitor, jsonResponse } = await load();
    fetchMock
      .mockResolvedValueOnce(jsonResponse('down', 400))
      .mockResolvedValueOnce(jsonResponse({ id: 'second-try' }));

    // First attempt fails loudly…
    await expect(getVisitor()).rejects.toThrow('Failed to create visitor');
    // …and the next caller gets a fresh attempt, not the cached rejection.
    await expect(getVisitor()).resolves.toMatchObject({ id: 'second-try' });
  });
});

describe('setVisitor', () => {
  it('PATCHes the visitor, caches the response, and notifies the third-party setters', async () => {
    const setter = vi.fn();
    const { setVisitor, cache, config, jsonResponse } = await load();
    config.thirdPartyUserSetters = [setter];
    cache.visitor = { id: 'v1' } as never;
    fetchMock.mockResolvedValue(jsonResponse({ id: 'v1', user_id: 'u1' }));

    await setVisitor({ user_id: 'u1' });

    expect(cache.visitor).toMatchObject({ user_id: 'u1' });
    expect(setter).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1' }));
  });

  it('a throwing setter does not reject a PATCH that already succeeded', async () => {
    const bad = vi.fn(() => {
      throw new Error('pixel not loaded');
    });
    const good = vi.fn();
    const { setVisitor, cache, config, jsonResponse } = await load();
    config.thirdPartyUserSetters = [bad, good];
    cache.visitor = { id: 'v1' } as never;
    fetchMock.mockResolvedValue(jsonResponse({ id: 'v1', user_id: 'u1' }));

    await expect(setVisitor({ user_id: 'u1' })).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
    expect(cache.visitor).toMatchObject({ user_id: 'u1' });
  });

  it('throws when the PATCH fails', async () => {
    const { setVisitor, cache, jsonResponse } = await load();
    cache.visitor = { id: 'v1' } as never;
    fetchMock.mockResolvedValue(jsonResponse('nope', 400));

    await expect(setVisitor({ user_id: 'u1' })).rejects.toThrow('Failed to set visitor');
  });
});
