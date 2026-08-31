// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
const sendBeacon = vi.fn();
vi.mock('../track/index', () => ({ track, sendBeacon }));

async function load() {
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const storage = memoryStorage();
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage }));
  return { storage };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  // Not running with vitest globals, so RTL's automatic cleanup never registers itself; without
  // this, every mounted Page leaves its document-level listeners behind for the next test.
  cleanup();
  vi.restoreAllMocks();
});

describe('useOutboundClickAnalytics', () => {
  async function mount() {
    await load();
    const { useOutboundClickAnalytics } = await import('./use-outbound-click-analytics');
    function Page({ children }: { children: React.ReactNode }) {
      useOutboundClickAnalytics();
      return <div>{children}</div>;
    }
    return { Page };
  }

  it('tracks a click on an external link', async () => {
    const { Page } = await mount();
    const { getByText } = render(
      <Page>
        <a href="https://elsewhere.example/deal">Great deal</a>
      </Page>
    );

    getByText('Great deal').click();

    expect(track).toHaveBeenCalledWith('click', {
      outbound: true,
      link_id: '',
      link_url: 'https://elsewhere.example/deal',
      link_text: 'Great deal',
      link_domain: 'elsewhere.example',
      link_classes: '',
    });
  });

  it('ignores same-host links', async () => {
    const { Page } = await mount();
    const { getByText } = render(
      <Page>
        <a href="/internal">Internal</a>
      </Page>
    );

    getByText('Internal').click();
    expect(track).not.toHaveBeenCalled();
  });

  it('caps link_text at the transport limit', async () => {
    const { Page } = await mount();
    const { getByRole } = render(
      <Page>
        <a href="https://elsewhere.example/">{'x'.repeat(900)}</a>
      </Page>
    );

    getByRole('link').click();
    expect(track.mock.calls[0][1].link_text).toHaveLength(512);
  });

  it('finds the anchor from a nested click target', async () => {
    const { Page } = await mount();
    const { getByText } = render(
      <Page>
        <a href="https://elsewhere.example/">
          <span>Nested</span>
        </a>
      </Page>
    );

    getByText('Nested').click();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on unmount', async () => {
    const { Page } = await mount();
    const { unmount } = render(<Page>x</Page>);
    unmount();

    const anchor = document.createElement('a');
    anchor.href = 'https://elsewhere.example/';
    document.body.appendChild(anchor);
    anchor.click();

    expect(track).not.toHaveBeenCalled();
  });
});

describe('useTrackImpression', () => {
  let intersect!: (isIntersecting: boolean) => void;
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          intersect = (isIntersecting) => cb([{ isIntersecting }]);
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mount() {
    await load();
    const { useTrackImpression } = await import('./use-track-impression');
    function Card() {
      const ref = useTrackImpression('view_promotion', { items: [] });
      return <div ref={ref}>card</div>;
    }
    return { Card };
  }

  it('fires once when the element becomes visible, then disconnects', async () => {
    const { Card } = await mount();
    render(<Card />);

    act(() => intersect(false));
    expect(track).not.toHaveBeenCalled();

    act(() => intersect(true));
    act(() => intersect(true));

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('view_promotion', { items: [] });
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('useWebAnalytics', () => {
  async function mount() {
    const { storage } = await load();
    const { useWebAnalytics } = await import('./use-web-analytics');
    function Page({ pathname }: { pathname: string }) {
      useWebAnalytics(pathname);
      return null;
    }
    return { Page, storage };
  }

  it('sends first_visit once ever, and page_view per pathname', async () => {
    const { Page, storage } = await mount();
    const { rerender } = render(<Page pathname="/a" />);

    expect(track).toHaveBeenCalledWith('first_visit', expect.objectContaining({ page_path: '/a' }));
    expect(storage.map.get('first_visit_time')).toBeTruthy();
    expect(track).toHaveBeenCalledWith(
      'page_view',
      expect.objectContaining({ page_path: '/a', previous_page_path: undefined })
    );

    rerender(<Page pathname="/b" />);
    expect(track).toHaveBeenCalledWith(
      'page_view',
      expect.objectContaining({ page_path: '/b', previous_page_path: '/a' })
    );
    // first_visit stays a one-time event
    expect(track.mock.calls.filter(([name]) => name === 'first_visit')).toHaveLength(1);
  });

  it('does not resend first_visit on a later visit', async () => {
    const { Page, storage } = await mount();
    storage.map.set('first_visit_time', '2026-01-01T00:00:00Z');

    render(<Page pathname="/a" />);
    expect(track.mock.calls.some(([name]) => name === 'first_visit')).toBe(false);
  });

  it('reports engagement over the beacon when the page is hidden', async () => {
    const { Page } = await mount();
    render(<Page pathname="/a" />);

    const { getSession } = await import('../setup/session');
    // jsdom's document.hasFocus() can be false, which would gate the accumulator shut.
    getSession().focus();
    // Give the accumulator something to flush: settle 5 fake seconds by hand.
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    getSession().updateAccumulator();
    vi.useRealTimers();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendBeacon).toHaveBeenCalledWith(
      'user_engagement',
      expect.objectContaining({ trigger: 'visibilitychange' })
    );
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  /** Puts the singleton session into a known accruing state and drains it. */
  async function primeSession() {
    const { getSession } = await import('../setup/session');
    const session = getSession();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    session.flush();
    return session;
  }

  it('sends scroll once per page at 90% depth, and re-arms on navigation', async () => {
    const { Page } = await mount();
    const { rerender } = render(<Page pathname="/a" />);
    await primeSession();

    // A page whose bottom 90% line is on screen: (300 + 800) / 1000 = 110%.
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });

    vi.useFakeTimers();
    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new Event('scroll'));

    const first = track.mock.calls.filter(([name]) => name === 'scroll');
    expect(first).toHaveLength(1);
    expect(first[0][1].engagement_time_msec).toBeGreaterThanOrEqual(3000);

    // Scrolling again on the same page must not resend.
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('scroll'));
    expect(track.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1);

    // A new page gets its own scroll event.
    rerender(<Page pathname="/b" />);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('scroll'));
    expect(track.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not send scroll below 90% depth', async () => {
    const { Page } = await mount();
    render(<Page pathname="/a" />);
    await primeSession();

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 10_000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });

    vi.useFakeTimers();
    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new Event('scroll'));
    vi.useRealTimers();

    expect(track.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(0);
  });

  it('a 90% crossing with no engaged time sends nothing, without consuming the one-shot', async () => {
    const { Page } = await mount();
    render(<Page pathname="/a" />);
    await primeSession();

    // The page reaches 90% while the window is unfocused (e.g. a restored scroll position), so
    // the accumulator has nothing: sendScroll refuses to report zero engagement.
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });

    vi.useFakeTimers();
    vi.advanceTimersByTime(3000); // unfocused time is not engagement
    window.dispatchEvent(new Event('scroll'));
    expect(track.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(0);

    // The silent crossing must not burn the page's one shot: once the user actually engages and
    // scrolls again, the event goes out with the time accrued since.
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('scroll'));

    const sent = track.mock.calls.filter(([name]) => name === 'scroll');
    expect(sent).toHaveLength(1);
    expect(sent[0][1].engagement_time_msec).toBeGreaterThanOrEqual(2000);

    // …and it stays a one-shot afterwards.
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('scroll'));
    vi.useRealTimers();
    expect(track.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1);
  });

  it('reports engagement over the beacon on pagehide', async () => {
    const { Page } = await mount();
    render(<Page pathname="/a" />);
    await primeSession();

    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();

    expect(sendBeacon).toHaveBeenCalledWith(
      'user_engagement',
      expect.objectContaining({ trigger: 'pagehide' })
    );
    const [, props] = sendBeacon.mock.calls.at(-1) as [string, { engagement_time_msec: number }];
    expect(props.engagement_time_msec).toBeGreaterThanOrEqual(2000);

    // pagehide marked the session inactive; hand the next test a live one.
    window.dispatchEvent(new Event('pageshow'));
  });

  it('cleans up every listener it added, capture phase included', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { Page } = await mount();

    const { unmount } = render(<Page pathname="/a" />);
    const added = addSpy.mock.calls.map(([type]) => type);
    unmount();
    const removed = removeSpy.mock.calls.map(([type]) => type);

    for (const type of added) {
      expect(removed).toContain(type);
    }
    // The checkpoint listeners are registered with capture and must be removed with it.
    const capturedRemovals = removeSpy.mock.calls.filter(
      ([type, , options]) =>
        ['mousedown', 'keydown', 'touchstart'].includes(type) &&
        typeof options === 'object' &&
        options.capture === true
    );
    expect(capturedRemovals).toHaveLength(3);
  });
});
