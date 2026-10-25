import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import { textRequestBody } from '../test/setup';
import type { TrackOptions } from './index';
import type { ThirdPartyTracker, TrackTags } from './types';

const fetchMock = vi.fn<typeof globalThis.fetch>();

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
  fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(textRequestBody(init)) as unknown[];
    return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
      status: 200,
    });
  });
}

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    const onError = vi.fn<NonNullable<TrackOptions['onError']>>();

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

describe('event ids', () => {
  it('generates a uuidv7 per event, session_start included, and sends it', async () => {
    const { track } = await load();
    respondWithIds();

    track('custom_action', { a: 1 });
    track('custom_action', { a: 2 });
    await vi.advanceTimersByTimeAsync(2000);

    const ids = sentBatches()[0].body.map((e) => e.id as string);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(id).toMatch(uuidv7);
    expect(new Set(ids).size).toBe(3);
  });

  it('passes the createTrackEventSchema check, version 7 enforced', async () => {
    const { track, storage } = await load();
    storage.map.delete('visitor_id'); // a generated, valid one
    respondWithIds();
    const { createTrackEventSchema } = await import('../schema/index');

    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    const body = sentBatches()[0].body;
    const parsed = createTrackEventSchema.parse(body);
    expect(parsed.map((e) => e.id)).toEqual(body.map((e) => e.id));
    const v4 = { ...body[0], id: '3b241101-e2bb-4255-8caf-4136c566a962' };
    expect(createTrackEventSchema.safeParse([v4]).success).toBe(false);
  });

  it('reports each event its own id, whatever ids the server answers with', async () => {
    const { track } = await load();
    respondWithIds(); // a server predating client ids answers with its own
    const first = vi.fn<NonNullable<TrackOptions['onSucceed']>>();
    const second = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

    track('custom_action', undefined, { onSucceed: first });
    track('custom_action', undefined, { onSucceed: second });
    await vi.advanceTimersByTimeAsync(2000);

    const [, one, two] = sentBatches()[0].body; // index 0 is session_start
    expect(first).toHaveBeenCalledWith({ id: one.id });
    expect(second).toHaveBeenCalledWith({ id: two.id });
  });

  it('takes any ok answer as stored: fewer ids, none, or a body that is not JSON', async () => {
    const { track, jsonResponse } = await load();
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();
    const onError = vi.fn<NonNullable<TrackOptions['onError']>>();

    for (const response of [
      jsonResponse([{ id: 'only-one' }]),
      new Response(null, { status: 204 }),
      new Response('ok', { status: 200 }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      track('custom_action', undefined, { onSucceed, onError });
      track('custom_action', undefined, { onSucceed, onError });
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(onError).not.toHaveBeenCalled();
    expect(onSucceed).toHaveBeenCalledTimes(6);
    const sent = sentBatches().flatMap((b) => b.body.filter((e) => e.name !== 'session_start'));
    expect(onSucceed.mock.calls.map(([response]) => response?.id)).toEqual(sent.map((e) => e.id));
  });

  it('a batch fetch retries goes out again under the same ids', async () => {
    const { track } = await load();
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      // The first attempt is stored by the server but its answer is lost on the way back.
      if (calls === 1) return new Response('bad gateway', { status: 502 });
      return new Response('[]', { status: 200 });
    });

    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(10_000); // the retry's backoff

    const batches = sentBatches();
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[1].body.map((e) => e.id)).toEqual(batches[0].body.map((e) => e.id));
  });
});

describe('callbacks and third parties', () => {
  it('reports onError to every event when the request fails', async () => {
    const { track, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    const onError = vi.fn<NonNullable<TrackOptions['onError']>>();

    track('custom_action', undefined, { onError });
    track('purchase', { value: 1, currency: 'USD', transaction_id: 't1', items: [] }, { onError });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('forwards to third-party trackers with the event id, skipping ignored events', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];
    respondWithIds();

    track('scroll', undefined); // enhanced-measurement events are not forwarded
    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(2000);

    // session_start is ignored too, so exactly one forward, under the id sent to the server.
    const signUp = sentBatches()[0].body.find((e) => e.name === 'sign_up');
    expect(tracker).toHaveBeenCalledTimes(1);
    expect(tracker).toHaveBeenCalledWith('sign_up', { method: 'email' }, signUp?.id);
  });

  it('fires the trackers synchronously as the event is tracked, before anything is sent', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];
    respondWithIds();

    track('sign_up', { method: 'email' });

    expect(tracker).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const [, , id] = tracker.mock.calls[0];
    expect(id).toMatch(uuidv7);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sentBatches()[0].body.find((e) => e.name === 'sign_up')?.id).toBe(id);
    expect(tracker).toHaveBeenCalledTimes(1); // not again once the server has answered
  });

  it('gives each event its own tracker id', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];

    track('sign_up', { method: 'email' });
    track('sign_up', { method: 'google' });

    const ids = tracker.mock.calls.map(([, , id]) => id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('fires the trackers even when the server rejects the batch', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { track, config, jsonResponse } = await load();
    config.thirdPartyTrackers = [tracker];
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid' }, 400));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(tracker).toHaveBeenCalledTimes(1);
  });

  it('a throwing tracker does not stop the others or fail the batch', async () => {
    const { bad, good } = vi.mockObject<{ bad: ThirdPartyTracker; good: ThirdPartyTracker }>({
      bad() {},
      good() {},
    });
    bad.mockImplementation(() => {
      throw new Error('pixel blocked');
    });
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();
    const { track, config } = await load();
    config.thirdPartyTrackers = [bad, good];
    respondWithIds();

    track('sign_up', { method: 'email' }, { onSucceed });
    await vi.advanceTimersByTimeAsync(2000);

    expect(good).toHaveBeenCalledTimes(1);
    expect(onSucceed).toHaveBeenCalledTimes(1);
  });

  it('calls a tracker that was not ready once more, on the next macrotask, with the same id', async () => {
    let ready = false;
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    tracker.mockImplementation(() => (ready ? undefined : false));
    const { track, config } = await load();
    config.thirdPartyTrackers = [tracker];

    track('sign_up', { method: 'email' });
    expect(tracker).toHaveBeenCalledTimes(1);
    ready = true; // the pixel snippet ran after the event was tracked
    await vi.advanceTimersByTimeAsync(0);

    expect(tracker).toHaveBeenCalledTimes(2);
    expect(tracker.mock.calls[1]).toEqual(tracker.mock.calls[0]);
    expect(tracker.mock.calls[1][2]).toMatch(uuidv7);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tracker).toHaveBeenCalledTimes(2);
  });

  it('gives up on a tracker that is still not ready, and does not re-call the ready ones', async () => {
    const { blocked, ready } = vi.mockObject<{
      blocked: ThirdPartyTracker;
      ready: ThirdPartyTracker;
    }>({ blocked() {}, ready() {} });
    blocked.mockImplementation(() => false);
    const { track, config } = await load();
    config.thirdPartyTrackers = [blocked, ready];
    respondWithIds();

    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(blocked).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('respects enableThirdPartyTracking: false', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
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
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

    await trackAsync('custom_action', { a: 1 }, { onSucceed });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, event] = sentBatches()[0].body; // index 0 is its session_start
    expect(onSucceed).toHaveBeenCalledWith({ id: event.id });
  });

  it('fires the trackers at once but resolves only once the server has answered', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { trackAsync, config } = await load();
    config.thirdPartyTrackers = [tracker];
    let answer!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    );

    let resolved = false;
    const pending = trackAsync('begin_checkout', { value: 1, currency: 'USD', items: [] }).then(
      () => (resolved = true)
    );
    expect(tracker).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    answer(new Response('[]', { status: 200 }));
    await pending;
    expect(resolved).toBe(true);
    expect(tracker).toHaveBeenCalledTimes(1);
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
    const onError = vi.fn<NonNullable<TrackOptions['onError']>>();

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
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

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
  const beacon = vi.fn<Navigator['sendBeacon']>(() => true);

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
    const onSucceed = vi.fn<NonNullable<TrackOptions['onSucceed']>>();

    track('page_view', undefined, { onSucceed });
    await vi.advanceTimersByTimeAsync(500); // tags settled, batch still waiting
    sendPendingEvents();

    const sent = await beaconed(0);
    expect(sent.map((e) => e.name)).toEqual(['session_start', 'page_view']);
    expect(sent[0]).toMatchObject({ tags: { utm_source: 'google' }, visitor_id: 'visitor-1' });
    expect(onSucceed).toHaveBeenCalledWith({ id: sent[1].id });
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

  it('beacons each event under the id its trackers already fired with, firing none again', async () => {
    const { tracker } = vi.mockObject<{ tracker: ThirdPartyTracker }>({ tracker() {} });
    const { track, sendPendingEvents, config } = await load();
    config.thirdPartyTrackers = [tracker];

    track('sign_up', { method: 'email' });
    expect(tracker).toHaveBeenCalledTimes(1);
    const [, , id] = tracker.mock.calls[0];
    // The page is hidden, then left, before the batch window closes: each runs this.
    sendPendingEvents();
    sendPendingEvents();

    expect(beacon).toHaveBeenCalledTimes(1);
    const sent = await beaconed(0);
    for (const event of sent) expect(event.id).toMatch(uuidv7);
    expect(sent.find((e) => e.name === 'sign_up')?.id).toBe(id);
    expect(tracker).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tracker).toHaveBeenCalledTimes(1);
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
  const beacon = vi.fn<Navigator['sendBeacon']>(() => true);

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
    const [, blob] = beacon.mock.calls[0];
    if (!(blob instanceof Blob)) throw new Error('Expected a Blob beacon body');
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

    const [, blob] = beacon.mock.calls[0];
    if (!(blob instanceof Blob)) throw new Error('Expected a Blob beacon body');
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
