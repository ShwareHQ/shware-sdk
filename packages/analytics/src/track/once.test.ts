import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import { textRequestBody } from '../test/setup';
import type { TrackOptions } from './index';

const fetchMock = vi.fn<typeof globalThis.fetch>();

/** A fresh module graph with a configured SDK, as in `index.test.ts`. */
async function load(overrides: Partial<Options> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage({ visitor_id: 'visitor-1' });
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage, ...overrides }));
  const { trackOnce } = await import('./once');
  return { storage, jsonResponse, trackOnce };
}

function respondWithIds() {
  fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(textRequestBody(init)) as unknown[];
    return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
      status: 200,
    });
  });
}

/** The names of every event sent, session_start left out. */
function sentNames() {
  return fetchMock.mock.calls.flatMap((call) => {
    const body = JSON.parse(textRequestBody(call[1])) as { name: string }[];
    return body.map((event) => event.name).filter((name) => name !== 'session_start');
  });
}

const purchase = { currency: 'USD', value: 9.99, transaction_id: 'cs_1' };

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('trackOnce', () => {
  it('tracks a key once, and remembers it only after the event was sent', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();

    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(true);
    expect(storage.map.has('track_once.purchase')).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.map.get('track_once.purchase')).toMatch(/^1\.[0-9a-z]+-cs_1$/);

    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase']);
  });

  it('does not queue a key twice before the first send', async () => {
    const { trackOnce } = await load();
    respondWithIds();

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase']);
  });

  it('keeps event names apart', async () => {
    const { trackOnce } = await load();
    respondWithIds();

    trackOnce('purchase', undefined, { key: 'cs_1' });
    trackOnce('purchase_failed', undefined, { key: 'cs_1' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase', 'purchase_failed']);
  });

  it('tries again after a send that failed', async () => {
    const { trackOnce, storage, jsonResponse } = await load();
    const onError = vi.fn<NonNullable<TrackOptions['onError']>>();
    // A 400 is not retried by fetch, so the batch fails at once.
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400));

    trackOnce('purchase', undefined, { key: 'cs_1', onError });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(storage.map.has('track_once.purchase')).toBe(false);

    respondWithIds();
    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase', 'purchase']);
  });

  it('calls the caller’s onSucceed', async () => {
    const { trackOnce } = await load();
    respondWithIds();
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

    trackOnce('purchase', undefined, { key: 'cs_1', onSucceed });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSucceed).toHaveBeenCalledTimes(1);
  });

  it('forgets a key once its ttl has passed', async () => {
    const { trackOnce } = await load();
    respondWithIds();

    trackOnce('purchase', undefined, { key: 'cs_1', ttl: 60_000 });
    await vi.advanceTimersByTimeAsync(2000);
    vi.advanceTimersByTime(60_000);

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
  });

  it('remembers the 20 latest keys per event', async () => {
    const { trackOnce } = await load();
    respondWithIds();

    for (let i = 0; i < 21; i++) {
      trackOnce('purchase', undefined, { key: `cs_${i}` });
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(trackOnce('purchase', undefined, { key: 'cs_20' })).toBe(false);
    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(false);
    expect(trackOnce('purchase', undefined, { key: 'cs_0' })).toBe(true);
  });

  it('round-trips keys with separator characters', async () => {
    const { trackOnce } = await load();
    respondWithIds();
    const key = 'order~1-a%b c';

    trackOnce('purchase', undefined, { key });
    await vi.advanceTimersByTimeAsync(2000);
    expect(trackOnce('purchase', undefined, { key })).toBe(false);
  });

  it('tracks anyway when the storage cannot be read', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();
    const getItem = storage.getItem;
    storage.getItem = (key) => {
      if (key.startsWith('track_once.')) throw new Error('storage unavailable');
      return getItem(key);
    };

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase']);
  });

  it('ignores a record it cannot parse', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();
    storage.map.set('track_once.purchase', 'garbage');

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.map.get('track_once.purchase')).toMatch(/^1\.[0-9a-z]+-cs_1$/);
  });
});
