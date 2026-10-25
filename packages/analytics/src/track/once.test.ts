import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import { textRequestBody } from '../test/setup';
import type { TrackOptions } from './index';
import type { ThirdPartyTracker } from './types';

const fetchMock = vi.fn<typeof globalThis.fetch>();

/** A fresh module graph with a configured SDK, as in `index.test.ts`. */
async function load(overrides: Partial<Options> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage({ visitor_id: 'visitor-1' });
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage, ...overrides }));
  const { trackOnce } = await import('./once');
  return { storage, jsonResponse, trackOnce, config: setup.config };
}

function respondWithIds() {
  fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(textRequestBody(init)) as unknown[];
    return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
      status: 200,
    });
  });
}

/** The stored record for `purchase`, parsed. */
function stored(storage: { map: Map<string, string> }) {
  const raw = storage.map.get('track_once.purchase');
  return raw === undefined
    ? undefined
    : (JSON.parse(raw) as { v: number; entries: [string, number][] });
}

/** The names of every event sent, session_start left out. */
function sentNames() {
  return fetchMock.mock.calls.flatMap((call) => {
    const body = JSON.parse(textRequestBody(call[1])) as { name: string }[];
    return body.map((event) => event.name).filter((name) => name !== 'session_start');
  });
}

/** The ids of every event sent, session_start left out. */
function sentIds() {
  return fetchMock.mock.calls.flatMap((call) => {
    const body = JSON.parse(textRequestBody(call[1])) as { name: string; id: string }[];
    return body.filter((event) => event.name !== 'session_start').map((event) => event.id);
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
    expect(stored(storage)).toEqual({
      v: 1,
      entries: [['cs_1', Date.parse('2026-01-01T00:00:02Z') + 90 * 24 * 60 * 60 * 1000]],
    });

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

  it('fires the pixels once per key, and a retry goes out under the first attempt’s id', async () => {
    const { trackOnce, storage, jsonResponse, config } = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    config.thirdPartyTrackers = [pixel];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400));

    trackOnce('purchase', purchase, { key: 'cs_1' });
    expect(pixel).toHaveBeenCalledTimes(1); // at once, before any send
    const [, , id] = pixel.mock.calls[0];
    await vi.advanceTimersByTimeAsync(2000);

    respondWithIds();
    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);

    expect(pixel).toHaveBeenCalledTimes(1);
    expect(sentIds()).toEqual([id, id]);
    // Sent: the attempt is settled, and the key remembered as before.
    expect(storage.map.get('track_once_attempt.purchase')).toBe('{"v":1,"entries":[]}');
    expect(stored(storage)?.entries.map(([key]) => key)).toEqual(['cs_1']);
  });

  it('reuses the id across a reload that lost the queued event', async () => {
    const first = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    first.config.thirdPartyTrackers = [pixel];
    first.trackOnce('purchase', purchase, { key: 'cs_1' });
    const [, , id] = pixel.mock.calls[0];

    // The page is reloaded before the batch went out: its timer dies with it, and a fresh
    // module graph starts on the same storage.
    vi.clearAllTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z')); // clearing the timers resets the clock
    vi.resetModules();
    const { baseOptions } = await import('../test/setup');
    const setup = await import('../setup/index');
    setup.setupAnalytics(baseOptions({ storage: first.storage }));
    setup.config.thirdPartyTrackers = [pixel];
    const { trackOnce } = await import('./once');
    respondWithIds();

    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pixel).toHaveBeenCalledTimes(1);
    expect(sentIds()).toEqual([id]);
  });

  it('gives each key its own id', async () => {
    const { trackOnce, config } = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    config.thirdPartyTrackers = [pixel];
    respondWithIds();

    trackOnce('purchase', purchase, { key: 'cs_1' });
    trackOnce('purchase', purchase, { key: 'cs_2' });
    await vi.advanceTimersByTimeAsync(2000);

    const ids = pixel.mock.calls.map(([, , id]) => id);
    expect(new Set(ids).size).toBe(2);
    expect(sentIds()).toEqual(ids);
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

  it('round-trips keys with JSON-unfriendly characters', async () => {
    const { trackOnce } = await load();
    respondWithIds();
    const key = 'order~1-a%b c"\\';

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
    expect(stored(storage)?.entries.map(([key]) => key)).toEqual(['cs_1']);
  });

  it('ignores a record of another version', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();
    storage.map.set(
      'track_once.purchase',
      JSON.stringify({ v: 2, entries: [['cs_1', Date.parse('2027-01-01T00:00:00Z')]] })
    );

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
  });

  it('keeps insertion order for integer-like keys', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();

    for (const key of ['b', '123', 'a']) {
      trackOnce('purchase', undefined, { key });
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(stored(storage)?.entries.map(([key]) => key)).toEqual(['b', '123', 'a']);
  });
});
