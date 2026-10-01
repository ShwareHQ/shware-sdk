import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import type { TrackTags } from './types';

const fetchMock = vi.fn();

/**
 * Loads a fresh module graph with a configured SDK and a cached visitor, so `sendEvents` never
 * needs the network for anything but the events request itself.
 */
async function load(overrides: Partial<Options> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage();
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage, ...overrides }));
  setup.cache.visitor = { id: 'visitor-1' } as never;
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

describe('when the visitor request fails', () => {
  it('the events stay queued, and the next send delivers them', async () => {
    const { track, cache, jsonResponse } = await load();
    cache.visitor = null; // the id has to come from the network
    const onError = vi.fn();
    const onSucceed = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // The visitor POST fails outright: nothing can be sent without an id, so nothing leaves the
    // queue — the events are not lost, they wait.
    fetchMock.mockResolvedValueOnce(jsonResponse('down', 400));
    track('custom_action', { a: 1 }, { onError, onSucceed });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSucceed).not.toHaveBeenCalled();
    // Only the visitor request went out — the events request never had an id to send with.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The network recovers: the failed visitor attempt was not cached, so the next send creates
    // the visitor and delivers both events — one bad request must not kill tracking for the page.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'visitor-2' }));
    respondWithIds();
    track('custom_action', { a: 2 }, { onError, onSucceed });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onSucceed).toHaveBeenCalledTimes(2);
    const events = sentBatches().at(-1)?.body;
    expect(events?.map((e) => e.name)).toEqual(['session_start', 'custom_action', 'custom_action']);
    expect(events?.every((e) => e.visitor_id === 'visitor-2')).toBe(true);
  });
});

describe('trackAsync', () => {
  it('sends without waiting for the batch window', async () => {
    const { trackAsync } = await load();
    respondWithIds();

    await trackAsync('custom_action', { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('reaches a batch still waiting for its visitor: it has not left the queue', async () => {
    const { track, sendPendingEvents, cache, storage } = await load();
    cache.visitor = null;
    storage.map.set('visitor_id', 'stored-visitor');
    let created!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        created = resolve;
      })
    );

    track('page_view', undefined);
    await vi.advanceTimersByTimeAsync(2000); // the send is awaiting the visitor request
    sendPendingEvents();

    expect((await beaconed(0)).map((e) => e.name)).toEqual(['session_start', 'page_view']);
    created(new Response(JSON.stringify({ id: 'stored-visitor' }), { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    // Only the visitor request: the events went by beacon, the send found the queue empty.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const { sendBeacon, cache, storage } = await load();
    cache.visitor = null; // the page's own round trip has not finished
    storage.map.set('visitor_id', 'stored-visitor');
    storage.map.set('session', `1.live-session.${Date.now()}`);

    sendBeacon('user_engagement', { engagement_time_msec: 1200, trigger: 'pagehide' });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    const [event] = JSON.parse(await blob.text());
    expect(event.visitor_id).toBe('stored-visitor');
    expect(event.tags).toEqual({});
  });

  it('skips a visitor the server has never seen', async () => {
    const { sendBeacon, cache } = await load();
    cache.visitor = null;

    sendBeacon('user_engagement', { engagement_time_msec: 1200, trigger: 'pagehide' });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('does not start a session for the event it reports', async () => {
    const { sendBeacon, cache, storage } = await load();
    cache.visitor = { id: 'visitor-1' } as never;
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
    const { sendBeacon, cache, storage } = await load();
    cache.visitor = { id: 'visitor-1' } as never;
    storage.map.set('session', `1.live-session.${Date.now()}`);

    expect(() =>
      sendBeacon('user_engagement', { engagement_time_msec: 5, trigger: 'pagehide' })
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
