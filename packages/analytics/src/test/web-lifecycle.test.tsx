// @vitest-environment jsdom
/**
 * End-to-end lifecycle of a web visit, through the real module graph: useWebAnalytics →
 * session → track → the wire. Only the network (fetch / sendBeacon) is mocked, so these tests
 * describe what a backend actually receives across a visitor's journey — the first landing, tab
 * switches, SPA navigations, the pagehide beacon, a reload, an expired session, a second tab.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60 * 1000;
const T0 = new Date('2026-01-01T10:00:00Z');

const fetchMock = vi.fn();
const beaconMock = vi.fn(() => true);

type Sent = { url: string; body: Record<string, unknown>[] };

function eventRequests(): Sent[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/events'))
    .map((call) => {
      const [url, init] = call as [string, RequestInit];
      return { url, body: JSON.parse(init.body as string) };
    });
}

async function beaconEvents() {
  const bodies = await Promise.all(
    beaconMock.mock.calls.map(async (call) => {
      const [, blob] = call as unknown as [string, Blob];
      return JSON.parse(await blob.text()) as Record<string, unknown>[];
    })
  );
  return bodies.flat();
}

type MemoryStorage = {
  map: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/** Loads a fresh module graph configured against the given storage, page mounted at `pathname`. */
async function launch(storage?: MemoryStorage) {
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const backing = storage ?? memoryStorage();
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage: backing }));
  const { useWebAnalytics } = await import('../hooks/use-web-analytics');
  const { track } = await import('../track/index');
  const { getSession } = await import('../setup/session');

  function Page({ pathname }: { pathname: string }) {
    useWebAnalytics(pathname);
    return null;
  }

  return { Page, storage: backing, track, getSession };
}

/**
 * Puts the mounted page front and center. Called after render — the hook's listeners must be
 * attached, and jsdom's initial document.hasFocus() is not to be relied on either way.
 */
function present() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  window.dispatchEvent(new Event('focus'));
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  beaconMock.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/events')) {
      const body = JSON.parse(init?.body as string) as unknown[];
      return new Response(JSON.stringify(body.map((_, i) => ({ id: `event-${i}` }))), {
        status: 200,
      });
    }
    // POST /visitors and PATCH /visitors/:id both answer the visitor.
    return new Response(JSON.stringify({ id: 'visitor-1' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window.navigator, 'sendBeacon', { value: beaconMock, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a first visit', () => {
  it('lands as one batch: session_start, then first_visit, then page_view — one session', async () => {
    const { Page, storage } = await launch();
    render(<Page pathname="/" />);
    present();

    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = eventRequests();
    expect(batch.body.map((e) => e.name)).toEqual(['session_start', 'first_visit', 'page_view']);

    const sessionIds = new Set(batch.body.map((e) => e.session_id));
    expect(sessionIds.size).toBe(1);
    for (const event of batch.body) {
      expect(event).toMatchObject({ visitor_id: 'visitor-1', platform: 'web' });
    }

    // session_start is stamped with the moment the visit began, not the flush.
    expect(batch.body[0].timestamp).toBe(T0.toISOString());
    expect(storage.map.get('first_visit_time')).toBeTruthy();
    expect(storage.map.get('session')).toContain([...sessionIds][0] as string);
  });

  it('asks the backend for a visitor exactly once, before the first batch', async () => {
    const { Page } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);

    const visitorCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/visitors'));
    expect(visitorCalls).toHaveLength(1);
  });
});

describe('engagement accounting', () => {
  it('counts only focused-and-visible time, reported by the beacon when the tab hides', async () => {
    const { Page } = await launch();
    render(<Page pathname="/" />);
    present();
    // The first batch starts the session, which re-anchors the engagement clock at this moment —
    // a new session never inherits time accrued before it began.
    await vi.advanceTimersByTimeAsync(2000);

    vi.advanceTimersByTime(8000); // 8 visible seconds
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(60_000); // a minute in another window: not engagement
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(5000); // 5 more seconds

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    const [engagement] = await beaconEvents();
    expect(engagement.name).toBe('user_engagement');
    expect(engagement.properties).toEqual({
      engagement_time_msec: 13_000,
      trigger: 'visibilitychange',
    });

    // The beacon reports into the same session the batch opened.
    const [batch] = eventRequests();
    expect(engagement.session_id).toBe(batch.body[0].session_id);
  });

  it('a hidden tab accrues nothing, so re-hiding sends no empty beacon', async () => {
    const { Page } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    beaconMock.mockClear();

    vi.advanceTimersByTime(10 * MINUTE); // hidden the whole time
    document.dispatchEvent(new Event('visibilitychange')); // still hidden

    expect(beaconMock).not.toHaveBeenCalled();
  });
});

describe('SPA navigation', () => {
  it('the next page_view names the previous page and carries its engagement time', async () => {
    const { Page } = await launch();
    const { rerender } = render(<Page pathname="/pricing" />);
    present();
    await vi.advanceTimersByTimeAsync(2000); // first batch: session starts, engagement re-anchors

    vi.advanceTimersByTime(3000); // 3 engaged seconds on /pricing since the session began
    rerender(<Page pathname="/checkout" />);
    await vi.advanceTimersByTimeAsync(2000);

    const batches = eventRequests();
    expect(batches).toHaveLength(2);
    const [pageView] = batches[1].body;
    expect(pageView).toMatchObject({ name: 'page_view' });
    expect(pageView.properties).toMatchObject({
      page_path: '/checkout',
      previous_page_path: '/pricing',
      engagement_time_msec: 3000,
    });

    // Same visit, same session — no second session_start.
    expect(batches[1].body.map((e) => e.name)).toEqual(['page_view']);
    expect(pageView.session_id).toBe(batches[0].body[0].session_id);
  });
});

describe('session expiry', () => {
  it('a visitor returning after 30 idle minutes starts a new session', async () => {
    const { Page, track } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);
    const first = eventRequests()[0].body[0].session_id;

    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    const batches = eventRequests();
    expect(batches[1].body.map((e) => e.name)).toEqual(['session_start', 'custom_action']);
    const second = batches[1].body[0].session_id;
    expect(second).not.toBe(first);
  });

  it('activity keeps a session alive well past 30 minutes of age', async () => {
    const { Page, track } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);
    const first = eventRequests()[0].body[0].session_id;

    // An event every 20 minutes for two hours: the session never times out.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(20 * MINUTE);
      track('custom_action', { i });
      await vi.advanceTimersByTimeAsync(2000);
    }

    const batches = eventRequests();
    const names = batches.flatMap((b) => b.body.map((e) => e.name));
    expect(names.filter((n) => n === 'session_start')).toHaveLength(1);
    for (const batch of batches) {
      for (const event of batch.body) expect(event.session_id).toBe(first);
    }
  });
});

describe('across page loads', () => {
  it('a reload within the timeout continues the same session and never repeats first_visit', async () => {
    const { Page, storage } = await launch();
    const { unmount } = render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);
    const first = eventRequests()[0].body[0].session_id;
    unmount();

    // The user reloads five minutes later: new module graph, same storage.
    vi.resetModules();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    const second = await launch(storage);
    render(<second.Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);

    const [batch] = eventRequests();
    expect(batch.body.map((e) => e.name)).toEqual(['page_view']); // no session_start, no first_visit
    expect(batch.body[0].session_id).toBe(first);
  });

  it('another tab keeps the shared session warm while this one idles', async () => {
    const { Page, track, storage } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);
    const first = eventRequests()[0].body[0].session_id as string;

    // 25 idle minutes here — but the other tab sent an event 5 minutes ago and, sharing the
    // cookie-backed storage, advanced the session clock.
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    storage.map.set('session', `1.${first}.${Date.now() - 5 * MINUTE}`);

    track('custom_action', { a: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    const batches = eventRequests();
    expect(batches[1].body.map((e) => e.name)).toEqual(['custom_action']);
    expect(batches[1].body[0].session_id).toBe(first);
  });

  it('the pagehide beacon reports a finished visit without reviving an expired session', async () => {
    const { Page, storage } = await launch();
    render(<Page pathname="/" />);
    present();
    await vi.advanceTimersByTimeAsync(2000);
    const first = eventRequests()[0].body[0].session_id as string;
    const stored = storage.map.get('session');

    // The tab sat hidden for 40 minutes, then the user closed it: the closing beacon still
    // belongs to the session that accrued it, but must not restart it.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await beaconEvents(); // drain the hide beacon
    beaconMock.mockClear();

    await vi.advanceTimersByTimeAsync(40 * MINUTE);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(1000); // one last second of reading
    window.dispatchEvent(new Event('pagehide'));

    const [engagement] = await beaconEvents();
    expect(engagement.session_id).toBe(first);
    expect(storage.map.get('session')).toBe(stored); // still expired for the next touch
  });
});
