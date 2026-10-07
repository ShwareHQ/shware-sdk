import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import type { TrackTags } from './types';

const fetchMock = vi.fn();

/**
 * Loads a fresh module graph with a configured SDK and a stored visitor id, so `sendEvents` never
 * needs the network for anything but the events request.
 */
async function load(overrides: Partial<Options> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage({ visitor_id: 'visitor-1' });
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage, ...overrides }));
  const track = await import('./index');
  return { storage, cache: setup.cache, config: setup.config, jsonResponse, ...track };
}

/** The ids the server would answer with, one per event sent. */
function respondWithIds() {
  fetchMock.mockImplementation(async (_url, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as unknown[];
    return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
      status: 200,
    });
  });
}

function sentBatches() {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string) as Record<string, unknown>[] };
  });
}

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

describe('batching', () => {
  it('holds events for the delay, then sends them in one request', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', { a: 1 });
    track('custom_action', { a: 2 });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    const [batch] = sentBatches();
    expect(batch.url).toBe('https://api.test/events');
    // keepalive lets the batch survive the tab closing while it is in flight.
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
    // session_start opens the batch: a fresh storage means a fresh session.
    expect(batch.body.map((e) => e.name)).toEqual([
      'session_start',
      'custom_action',
      'custom_action',
    ]);
  });

  it('a full batch sends immediately and cancels the pending timer', async () => {
    const { track } = await load();
    respondWithIds();

    for (let i = 0; i < 10; i++) track('custom_action', { i });
    await vi.advanceTimersByTimeAsync(0); // let the async send reach the wire
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The timer armed by the early pushes must not fire a second, empty send.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the visitor, session and config identity on every event', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', undefined);
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    for (const event of batch.body) {
      expect(event).toMatchObject({
        visitor_id: 'visitor-1',
        platform: 'web',
        environment: 'production',
      });
      expect(event.session_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('the visitor', () => {
  const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('a first visit sends at once under an id generated and kept here', async () => {
    const { track, storage } = await load();
    storage.map.delete('visitor_id');
    respondWithIds();

    track('page_view', undefined);
    await vi.advanceTimersByTimeAsync(2000);

    const batch = sentBatches().find((b) => b.url.endsWith('/events'));
    const id = storage.map.get('visitor_id');
    expect(id).toMatch(uuidv7);
    expect(batch?.body.every((e) => e.visitor_id === id)).toBe(true);
  });

  it('sending never touches the visitor endpoint: the id is all an event needs', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', { i: 0 });
    await vi.advanceTimersByTimeAsync(2000);

    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual(['https://api.test/events']);
  });
});

describe('session_start', () => {
  it('carries the timestamp of the event that opened the session', async () => {
    const { track } = await load();
    respondWithIds();

    const opening = new Date().toISOString();
    track('custom_action', undefined);
    vi.advanceTimersByTime(1000); // the flush happens later than the event
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    expect(batch.body[0]).toMatchObject({ name: 'session_start', timestamp: opening });
  });

  it('is absent when the session is already live', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', undefined);
    await vi.advanceTimersByTimeAsync(2000);
    track('custom_action', undefined);
    await vi.advanceTimersByTimeAsync(2000);

    const batches = sentBatches();
    expect(batches[1].body.map((e) => e.name)).toEqual(['custom_action']);
  });

  it('carries the tags of the event that opened the session, not the tags at flush time', async () => {
    // Each capture sees a different page: the landing page with its utm parameters first, then
    // the page it redirected to before the batch went out.
    let calls = 0;
    const { track } = await load({ getTags: () => ({ call: ++calls }) });
    respondWithIds();

    track('page_view', undefined); // captures call 1, on the landing page
    vi.advanceTimersByTime(1000); // the SPA has navigated on by the time the batch is flushed
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    expect(batch.body[0].name).toBe('session_start');
    expect((batch.body[0].tags as TrackTags).call).toBe(1);
    expect(calls).toBe(1); // no capture of its own
  });

  it('goes out again with the next batch of the session when its own batch was rejected', async () => {
    let calls = 0;
    const { track, jsonResponse } = await load({ getTags: () => ({ call: ++calls }) });
    const onError = vi.fn();

    // A 400 is not retried by fetch: one invalid event has failed the batch, session_start with it.
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400));
    const opening = new Date().toISOString();
    track('custom_action', { a: 1 }, { onError });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledTimes(1);

    respondWithIds();
    vi.advanceTimersByTime(5000);
    track('custom_action', { a: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    track('custom_action', { a: 3 });
    await vi.advanceTimersByTimeAsync(2000);

    const batches = sentBatches();
    expect(batches).toHaveLength(3);
    // The same announcement — landing tags, opening timestamp, same session — once, not twice.
    expect(batches[1].body.map((e) => e.name)).toEqual(['session_start', 'custom_action']);
    expect(batches[1].body[0]).toMatchObject({
      timestamp: opening,
      tags: { call: 1 },
      session_id: batches[1].body[1].session_id,
    });
    expect(batches[2].body.map((e) => e.name)).toEqual(['custom_action']);
  });

  it('a queue spanning the session timeout announces each session it holds', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', { a: 1 });
    // A tab frozen before its timer fired, resumed 31 minutes later: Date moves, timers do not.
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    track('custom_action', { a: 2 });
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    expect(batch.body.map((e) => e.name)).toEqual([
      'session_start',
      'custom_action',
      'session_start',
      'custom_action',
    ]);
    expect(batch.body[0].session_id).toBe(batch.body[1].session_id);
    expect(batch.body[2].session_id).toBe(batch.body[3].session_id);
    expect(batch.body[0].session_id).not.toBe(batch.body[2].session_id);
  });

  it('keeps its own session when a new one has started since', async () => {
    const { track, jsonResponse } = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400));
    const opening = new Date().toISOString();
    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    // Half an hour later the next event opens a new session, which announces itself; the
    // retried announcement still goes out, under the session it belongs to: the visit happened.
    respondWithIds();
    vi.advanceTimersByTime(31 * 60 * 1000);
    const reopening = new Date().toISOString();
    track('custom_action', { a: 2 });
    await vi.advanceTimersByTimeAsync(2000);

    const [, batch] = sentBatches();
    const starts = batch.body.filter((e) => e.name === 'session_start');
    expect(starts.map((e) => e.timestamp)).toEqual([opening, reopening]);
    expect(starts[0].session_id).not.toBe(starts[1].session_id);
  });
});

describe('tags', () => {
  it('are captured when the event happens, not when the batch is sent', async () => {
    let calls = 0;
    const { track } = await load({ getTags: () => ({ call: ++calls }) });
    respondWithIds();

    track('custom_action', undefined); // captures call 1
    track('custom_action', undefined); // captures call 2
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    const clicks = batch.body.filter((e) => e.name === 'custom_action');
    expect(clicks.map((e) => (e.tags as TrackTags).call)).toEqual([1, 2]);
  });

  it('falls back to the last built tags when getTags throws', async () => {
    let calls = 0;
    const { track, cache } = await load({
      getTags: () => {
        if (++calls > 1) throw new Error('boom');
        return { call: calls };
      },
    });
    cache.tags = { call: 1 };
    respondWithIds();

    track('custom_action', undefined);
    track('custom_action', undefined); // this capture throws
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = sentBatches();
    const clicks = batch.body.filter((e) => e.name === 'custom_action');
    expect(clicks.map((e) => (e.tags as TrackTags).call)).toEqual([1, 1]);
  });
});

describe('deepLink', () => {
  it("merges the app's opening link into every event's tags, over the platform's", async () => {
    const listen = vi.fn<() => void>();
    const { track, cache } = await load({
      getTags: () => ({ utm_source: 'google-play', os: 'Android 16' }),
      deepLink: { listen, getTags: () => ({ page_location: 'myapp://', utm_source: 'lifecycle' }) },
    });
    respondWithIds();

    track('custom_action', undefined);
    await vi.advanceTimersByTimeAsync(2000);

    expect(listen).toHaveBeenCalledTimes(1);
    const [batch] = sentBatches();
    const click = batch.body.find((e) => e.name === 'custom_action');
    expect(click?.tags).toEqual({
      utm_source: 'lifecycle',
      os: 'Android 16',
      page_location: 'myapp://',
    });
    // and kept as the last built tags, for the events that cannot wait for theirs
    expect(cache.tags).toEqual(click?.tags);
  });

  it('logs a listen that throws instead of breaking the setup', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('no linking module');
    await expect(
      load({
        deepLink: {
          listen: () => {
            throw failure;
          },
          getTags: () => ({}),
        },
      })
    ).resolves.toBeDefined();
    expect(error).toHaveBeenCalledWith('analytics deepLink.listen failed', failure);
    error.mockRestore();
  });
});

describe('callbacks and third parties', () => {
  it('reports each event its own id', async () => {
    const { track } = await load();
    respondWithIds();
    const first = vi.fn();
    const second = vi.fn();

    track('custom_action', undefined, { onSucceed: first });
    track('custom_action', undefined, { onSucceed: second });
    await vi.advanceTimersByTimeAsync(2000);

    // index 0 is session_start
    expect(first).toHaveBeenCalledWith({ id: 'event-1' });
    expect(second).toHaveBeenCalledWith({ id: 'event-2' });
  });

  it('survives a response carrying fewer ids than events', async () => {
    const { track, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse([{ id: 'only-one' }]));
    const onSucceed = vi.fn();

    track('custom_action', undefined, { onSucceed });
    track('custom_action', undefined, { onSucceed });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onSucceed).toHaveBeenCalledTimes(2);
    expect(onSucceed).toHaveBeenLastCalledWith(undefined);
  });

  it('reports onError to every event when the request fails', async () => {
    const { track, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    const onError = vi.fn();

    track('custom_action', undefined, { onError });
    track('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] }, { onError });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('forwards to third-party trackers with the event id, skipping ignored events', async () => {
    const tracker = vi.fn();
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];
    respondWithIds();

    track('scroll', undefined); // enhanced-measurement events are not forwarded
    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(2000);

    // session_start is ignored too, so exactly one forward.
    expect(tracker).toHaveBeenCalledTimes(1);
    expect(tracker).toHaveBeenCalledWith('sign_up', { method: 'email' }, 'event-2');
  });

  it('a throwing tracker does not stop the others or fail the batch', async () => {
    const bad = vi.fn(() => {
      throw new Error('pixel blocked');
    });
    const good = vi.fn();
    const onSucceed = vi.fn();
    const { track, config } = await load();
    config.thirdPartyTrackers = [bad, good];
    respondWithIds();

    track('sign_up', { method: 'email' }, { onSucceed });
    await vi.advanceTimersByTimeAsync(2000);

    expect(good).toHaveBeenCalledTimes(1);
    expect(onSucceed).toHaveBeenCalledTimes(1);
  });

  it('respects enableThirdPartyTracking: false', async () => {
    const tracker = vi.fn();
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];
    respondWithIds();

    track('sign_up', { method: 'email' }, { enableThirdPartyTracking: false });
    await vi.advanceTimersByTimeAsync(2000);

    expect(tracker).not.toHaveBeenCalled();
  });
});

describe('trackAsync', () => {
  it('sends without waiting for the batch window, and resolves once it is sent', async () => {
    const { trackAsync } = await load();
    respondWithIds();
    const onSucceed = vi.fn();

    await trackAsync('custom_action', { a: 1 }, { onSucceed });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSucceed).toHaveBeenCalledWith({ id: 'event-1' }); // event-0 is its session_start
  });

  it('takes the queued events along in its request', async () => {
    const { track, trackAsync } = await load();
    respondWithIds();

    track('custom_action', { queued: true });
    await trackAsync('custom_action', { now: true });
    expect(sentBatches().map((b) => b.body.map((e) => e.properties))).toEqual([
      [{}, { queued: true }, { now: true }],
    ]);
  });

  it('resolves, without rejecting, when the batch is rejected', async () => {
    const { trackAsync, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid' }, 400));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onError = vi.fn();

    await expect(trackAsync('custom_action', { a: 1 }, { onError })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('resolves when the send cannot start, the event left queued for the next send', async () => {
    let failing = true;
    const { trackAsync, track } = await load({
      getHeaders: () => {
        if (failing) throw new Error('no token');
        return {};
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const onSucceed = vi.fn();

    // Resolves without any fake time passing: it is not waiting on a send that may never come.
    await trackAsync('custom_action', { a: 9 }, { onSucceed });
    expect(onSucceed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    failing = false;
    respondWithIds();
    track('custom_action', { a: 10 });
    await vi.advanceTimersByTimeAsync(2000);
    const sent = sentBatches().at(-1)?.body ?? [];
    expect(sent.map((e) => [e.name, e.properties])).toEqual([
      ['session_start', {}],
      ['custom_action', { a: 9 }],
      ['custom_action', { a: 10 }],
    ]);
    expect(onSucceed).toHaveBeenCalledTimes(1);
  });
});

describe('keepalive', () => {
  function keepalive(call: number) {
    return (fetchMock.mock.calls[call] as [string, RequestInit])[1].keepalive;
  }

  it('lets a batch outlive the page', async () => {
    const { track } = await load();
    respondWithIds();
    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(keepalive(0)).toBe(true);
  });

  it('is left off a body over its 64KB budget, which would otherwise fail outright', async () => {
    const { track } = await load();
    respondWithIds();
    track('custom_action', { blob: 'x'.repeat(70_000) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(keepalive(0)).toBe(false);
    expect(sentBatches()).toHaveLength(1);
  });
});

describe('sendPendingEvents', () => {
  const beacon = vi.fn(() => true);

  beforeEach(() => {
    beacon.mockReset();
    beacon.mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
  });

  async function beaconed(call: number) {
    const [, blob] = beacon.mock.calls[call] as unknown as [string, Blob];
    return JSON.parse(await blob.text()) as Record<string, unknown>[];
  }

  it('sends the queue, session_start first, and cancels the batch timer', async () => {
    const { track, sendPendingEvents } = await load({ getTags: () => ({ utm_source: 'google' }) });
    respondWithIds();
    const onSucceed = vi.fn();

    track('page_view', undefined, { onSucceed });
    await vi.advanceTimersByTimeAsync(500); // tags settled, batch still waiting
    sendPendingEvents();

    const sent = await beaconed(0);
    expect(sent.map((e) => e.name)).toEqual(['session_start', 'page_view']);
    expect(sent[0]).toMatchObject({ tags: { utm_source: 'google' }, visitor_id: 'visitor-1' });
    expect(onSucceed).toHaveBeenCalledWith(undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('beacons a first visit left before any request returned: the id is local', async () => {
    const { track, sendPendingEvents, storage } = await load();
    storage.map.delete('visitor_id');

    track('page_view', undefined);
    sendPendingEvents(); // left at once: no batch, no visitor request has been sent

    const sent = await beaconed(0);
    expect(sent.map((e) => e.name)).toEqual(['session_start', 'page_view']);
    expect(sent.every((e) => e.visitor_id === storage.map.get('visitor_id'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the queue to the usual send when no beacon can take it', async () => {
    const { track, sendPendingEvents } = await load();
    respondWithIds();
    beacon.mockReturnValue(false);

    track('page_view', undefined);
    sendPendingEvents();
    await vi.advanceTimersByTimeAsync(0);

    expect(sentBatches()[0].body.map((e) => e.name)).toEqual(['session_start', 'page_view']);
  });

  it('fires no third-party tracker for what it beacons: there is no server id to dedupe with', async () => {
    const tracker = vi.fn();
    const { track, sendPendingEvents, config } = await load();
    config.thirdPartyTrackers = [tracker];

    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(0);
    sendPendingEvents();

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(tracker).not.toHaveBeenCalled();
  });

  it('sends an event whose tags have not settled with the last built ones', async () => {
    const { track, sendPendingEvents, cache } = await load({
      getTags: () => new Promise<TrackTags>(() => {}), // a short-link lookup still in flight
    });
    cache.tags = { utm_source: 'last-built' };

    track('page_view', undefined);
    sendPendingEvents();

    const sent = await beaconed(0);
    expect(sent.map((e) => e.tags)).toEqual([
      { utm_source: 'last-built' },
      { utm_source: 'last-built' },
    ]);
  });

  it('sends nothing when nothing is queued', async () => {
    const { sendPendingEvents } = await load();
    sendPendingEvents();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('sendBeacon', () => {
  const beacon = vi.fn(() => true);

  beforeEach(() => {
    beacon.mockClear();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
  });

  it('falls back to the stored visitor id before the first batch has returned', async () => {
    const { sendBeacon, storage } = await load();
    storage.map.set('visitor_id', 'stored-visitor');
    storage.map.set('session', `1.live-session.${Date.now()}`);

    sendBeacon('user_engagement', { engagement_time_msec: 1200, trigger: 'pagehide' });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    const [event] = JSON.parse(await blob.text());
    expect(event.visitor_id).toBe('stored-visitor');
    expect(event.tags).toEqual({});
    // A CORS simple request: no preflight for a closing page to wait on.
    expect(blob.type).toBe('text/plain;charset=utf-8');
  });

  it('skips a visitor the server has never seen', async () => {
    const { sendBeacon } = await load();

    sendBeacon('user_engagement', { engagement_time_msec: 1200, trigger: 'pagehide' });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('does not start a session for the event it reports', async () => {
    const { sendBeacon, storage } = await load();
    const stale = Date.now() - 45 * 60 * 1000;
    storage.map.set('session', `1.old-session.${stale}`);

    sendBeacon('user_engagement', { engagement_time_msec: 1200, trigger: 'pagehide' });

    const [, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    const [event] = JSON.parse(await blob.text());
    expect(event.session_id).toBe('old-session');
    expect(storage.map.get('session')).toBe(`1.old-session.${stale}`);
  });

  it('warns instead of throwing when the browser refuses the beacon', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    beacon.mockReturnValueOnce(false);
    const { sendBeacon, storage } = await load();
    storage.map.set('session', `1.live-session.${Date.now()}`);

    expect(() =>
      sendBeacon('user_engagement', { engagement_time_msec: 5, trigger: 'pagehide' })
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
