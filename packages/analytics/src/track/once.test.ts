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
  const { sendPendingEvents } = await import('./index');
  return { storage, jsonResponse, trackOnce, sendPendingEvents, config: setup.config };
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
    : (JSON.parse(raw) as { v: number; entries: [string, string, number, boolean][] });
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
    // Queued, not sent: remembered with its id, as unsent.
    const queued = stored(storage);
    expect(queued?.entries.map(([key, , , sent]) => [key, sent])).toEqual([['cs_1', false]]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(stored(storage)).toEqual({
      v: 2,
      entries: [
        [
          'cs_1',
          queued?.entries[0][1],
          Date.parse('2026-01-01T00:00:02Z') + 90 * 24 * 60 * 60 * 1000,
          true,
        ],
      ],
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
    expect(stored(storage)?.entries.map(([key, , , sent]) => [key, sent])).toEqual([
      ['cs_1', false],
    ]);

    respondWithIds();
    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase', 'purchase']);
  });

  it('fires the pixels once per key, and a retry goes out under the first attempt’s id', async () => {
    const { trackOnce, storage, jsonResponse, config } = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    config.integrations = [{ type: 'analytics', track: pixel }];
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
    // Sent: the one entry, under the one id, now marked sent.
    expect(stored(storage)?.entries.map(([key, eid, , sent]) => [key, eid, sent])).toEqual([
      ['cs_1', id, true],
    ]);
  });

  it('reuses the id across a reload that lost the queued event', async () => {
    const first = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    first.config.integrations = [{ type: 'analytics', track: pixel }];
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
    setup.config.integrations = [{ type: 'analytics', track: pixel }];
    const { trackOnce } = await import('./once');
    respondWithIds();

    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pixel).toHaveBeenCalledTimes(1);
    expect(sentIds()).toEqual([id]);
  });

  it('leaves a key sent by beacon unsent, and sends it again under its id on the next page', async () => {
    const beacon = vi.fn<Navigator['sendBeacon']>(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const first = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    first.config.integrations = [{ type: 'analytics', track: pixel }];
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

    first.trackOnce('purchase', purchase, { key: 'cs_1', onSucceed });
    const [, , id] = pixel.mock.calls[0];
    first.sendPendingEvents(); // the page is hidden before the batch went out
    const [, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    const beaconed = JSON.parse(await blob.text()) as { name: string; id: string }[];
    expect(beaconed.find((event) => event.name === 'purchase')?.id).toBe(id);
    expect(onSucceed).toHaveBeenCalledWith({ id, beacon: true });
    // Queued by the browser, not confirmed: still unsent, under the same id.
    expect(stored(first.storage)?.entries.map(([key, eid, , sent]) => [key, eid, sent])).toEqual([
      ['cs_1', id, false],
    ]);

    // The result page is opened again: a fresh module graph on the same storage.
    vi.clearAllTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    vi.resetModules();
    const { baseOptions } = await import('../test/setup');
    const setup = await import('../setup/index');
    setup.setupAnalytics(baseOptions({ storage: first.storage }));
    setup.config.integrations = [{ type: 'analytics', track: pixel }];
    const { trackOnce } = await import('./once');
    respondWithIds();

    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pixel).toHaveBeenCalledTimes(1);
    expect(sentIds()).toEqual([id]);
    expect(stored(first.storage)?.entries.map(([key, eid, , sent]) => [key, eid, sent])).toEqual([
      ['cs_1', id, true],
    ]);
    expect(trackOnce('purchase', purchase, { key: 'cs_1' })).toBe(false);
  });

  it('gives each key its own id', async () => {
    const { trackOnce, config } = await load();
    const { pixel } = vi.mockObject<{ pixel: ThirdPartyTracker }>({ pixel() {} });
    config.integrations = [{ type: 'analytics', track: pixel }];
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
      JSON.stringify({ v: 3, entries: [['cs_1', 'id', Date.parse('2027-01-01T00:00:00Z'), true]] })
    );

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(true);
  });

  it('reads a v1 record as sent keys, and rewrites it as v2', async () => {
    const { trackOnce, storage } = await load();
    respondWithIds();
    const expiresAt = Date.parse('2027-01-01T00:00:00Z');
    storage.map.set(
      'track_once.purchase',
      JSON.stringify({
        v: 1,
        entries: [
          ['cs_1', expiresAt],
          ['cs_2', expiresAt],
        ],
      })
    );

    expect(trackOnce('purchase', undefined, { key: 'cs_1' })).toBe(false);
    expect(trackOnce('purchase', undefined, { key: 'cs_2' })).toBe(false);
    expect(trackOnce('purchase', undefined, { key: 'cs_3' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentNames()).toEqual(['purchase']);
    expect(stored(storage)?.v).toBe(2);
    expect(
      stored(storage)?.entries.map(([key, , exp, sent]) => [key, exp === expiresAt, sent])
    ).toEqual([
      ['cs_1', true, true],
      ['cs_2', true, true],
      ['cs_3', false, true],
    ]);
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
