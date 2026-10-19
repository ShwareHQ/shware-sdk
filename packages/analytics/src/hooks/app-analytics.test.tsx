// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Activity, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
const sendPendingEvents = vi.fn();
vi.mock('../track/index', () => ({ track, sendBeacon: vi.fn(), sendPendingEvents }));

const { appState } = vi.hoisted(() => ({
  appState: {
    listeners: [] as ((state: string) => void)[],
    remove: vi.fn(),
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listeners.push(listener);
      return { remove: appState.remove };
    },
  },
}));

function setAppState(state: 'active' | 'background' | 'inactive') {
  act(() => {
    appState.listeners.forEach((listener) => listener(state));
  });
}

async function mount() {
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const storage = memoryStorage();
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage, platform: 'ios' }));
  const { useAppAnalytics } = await import('./use-app-analytics');
  const { getSession } = await import('../setup/session');

  function Screen({ pathname }: { pathname: string }) {
    useAppAnalytics(pathname);
    return null;
  }
  // The accumulator only runs focused + visible + active; make that state explicit.
  getSession().focus();
  return { Screen, storage, session: getSession() };
}

beforeEach(() => {
  vi.clearAllMocks();
  appState.listeners.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAppAnalytics', () => {
  it.each([false, true])(
    'preserves the screen predecessor and engagement flush on Activity restoration (navigated: %s)',
    async (navigate) => {
      const { Screen, session } = await mount();
      const flush = vi.spyOn(session, 'flush').mockReturnValue(1234);
      const view = render(
        <Activity mode="visible">
          <Screen pathname="/a" />
        </Activity>
      );
      const pathname = navigate ? '/b' : '/a';
      if (navigate) {
        view.rerender(
          <Activity mode="visible">
            <Screen pathname={pathname} />
          </Activity>
        );
      }
      view.rerender(
        <Activity mode="hidden">
          <Screen pathname={pathname} />
        </Activity>
      );
      track.mockClear();
      flush.mockClear();

      view.rerender(
        <Activity mode="visible">
          <Screen pathname={pathname} />
        </Activity>
      );

      expect(flush).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenLastCalledWith(
        'screen_view',
        expect.objectContaining({
          screen_name: pathname,
          previous_screen_class: pathname,
          engagement_time_msec: 1234,
        })
      );
    }
  );

  it('uses the last queued screen after navigation while Activity effects are hidden', async () => {
    const { Screen } = await mount();
    const views = () => track.mock.calls.filter(([name]) => name === 'screen_view');
    const view = render(
      <Activity mode="visible">
        <Screen pathname="/a" />
      </Activity>
    );
    view.rerender(
      <Activity mode="hidden">
        <Screen pathname="/b" />
      </Activity>
    );
    view.rerender(
      <Activity mode="hidden">
        <Screen pathname="/c" />
      </Activity>
    );
    expect(views()).toHaveLength(1);
    view.rerender(
      <Activity mode="visible">
        <Screen pathname="/c" />
      </Activity>
    );
    expect(views()).toHaveLength(2);
    expect(views()[1][1]).toMatchObject({ screen_name: '/c', previous_screen_class: '/a' });
  });

  it('preserves the empty previous screen path without flushing its engagement', async () => {
    const { Screen, session } = await mount();
    const flush = vi.spyOn(session, 'flush');
    const view = render(<Screen pathname="" />);
    view.rerender(<Screen pathname="/home" />);
    expect(track).toHaveBeenLastCalledWith(
      'screen_view',
      expect.objectContaining({
        screen_name: '/home',
        previous_screen_class: '',
        engagement_time_msec: undefined,
      })
    );
    expect(flush).not.toHaveBeenCalled();
  });

  it('uses the first queued screen as predecessor during Strict Mode effect replay', async () => {
    const { Screen, session } = await mount();
    const flush = vi.spyOn(session, 'flush').mockReturnValue(1234);
    const view = render(
      <StrictMode>
        <Screen pathname="/home" />
      </StrictMode>
    );
    const initial = track.mock.calls.filter(([name]) => name === 'screen_view');
    expect(initial).toHaveLength(2);
    expect(initial.map(([, props]) => props.previous_screen_class)).toEqual([undefined, '/home']);
    expect(initial.map(([, props]) => props.engagement_time_msec)).toEqual([undefined, 1234]);
    expect(flush).toHaveBeenCalledTimes(1);
    view.rerender(
      <StrictMode>
        <Screen pathname="/settings" />
      </StrictMode>
    );
    expect(track).toHaveBeenLastCalledWith(
      'screen_view',
      expect.objectContaining({ screen_name: '/settings', previous_screen_class: '/home' })
    );
    view.rerender(
      <StrictMode>
        <Screen pathname="/home" />
      </StrictMode>
    );
    expect(track).toHaveBeenLastCalledWith(
      'screen_view',
      expect.objectContaining({ screen_name: '/home', previous_screen_class: '/settings' })
    );
  });

  it('sends first_open once ever, and screen_view per screen', async () => {
    const { Screen, storage } = await mount();
    const { rerender } = render(<Screen pathname="/home" />);

    expect(track).toHaveBeenCalledWith('first_open', {
      screen_name: '/home',
      screen_class: '/home',
    });
    expect(storage.map.get('first_open_time')).toBeTruthy();
    expect(track).toHaveBeenCalledWith(
      'screen_view',
      expect.objectContaining({
        screen_name: '/home',
        previous_screen_class: undefined,
        engagement_time_msec: undefined,
      })
    );

    rerender(<Screen pathname="/settings" />);
    expect(track).toHaveBeenCalledWith(
      'screen_view',
      expect.objectContaining({ screen_name: '/settings', previous_screen_class: '/home' })
    );
    expect(track.mock.calls.filter(([name]) => name === 'first_open')).toHaveLength(1);
  });

  it('keeps the last queued screen as predecessor through forward and back navigation', async () => {
    const { Screen } = await mount();
    const view = render(<Screen pathname="/a" />);
    for (const pathname of ['/b', '/c', '/b', '/a']) {
      view.rerender(<Screen pathname={pathname} />);
    }
    const views = track.mock.calls.filter(([name]) => name === 'screen_view');
    expect(views.map(([, props]) => [props.screen_name, props.previous_screen_class])).toEqual([
      ['/a', undefined],
      ['/b', '/a'],
      ['/c', '/b'],
      ['/b', '/c'],
      ['/a', '/b'],
    ]);
  });

  it('does not resend first_open on a later launch', async () => {
    const { Screen, storage } = await mount();
    storage.map.set('first_open_time', '2026-01-01T00:00:00Z');

    render(<Screen pathname="/home" />);
    expect(track.mock.calls.some(([name]) => name === 'first_open')).toBe(false);
  });

  it('a screen switch carries the previous screen engagement time', async () => {
    const { Screen, session } = await mount();
    const { rerender } = render(<Screen pathname="/home" />);
    session.flush();

    vi.useFakeTimers();
    vi.advanceTimersByTime(4000);
    rerender(<Screen pathname="/paywall" />);
    vi.useRealTimers();

    const view = track.mock.calls.find(
      ([name, props]) => name === 'screen_view' && props.screen_name === '/paywall'
    );
    expect(view?.[1].engagement_time_msec).toBeGreaterThanOrEqual(4000);
  });

  it('reports engagement when the app goes to background, once', async () => {
    const { Screen, session } = await mount();
    render(<Screen pathname="/home" />);
    session.flush();

    vi.useFakeTimers();
    vi.advanceTimersByTime(6000);
    setAppState('background');
    vi.useRealTimers();

    const engagements = track.mock.calls.filter(([name]) => name === 'user_engagement');
    expect(engagements).toHaveLength(1);
    expect(engagements[0][1]).toMatchObject({ trigger: 'background' });
    expect(engagements[0][1].engagement_time_msec).toBeGreaterThanOrEqual(6000);
    expect(session.isActive()).toBe(false);

    // A second background transition without foreground activity adds nothing.
    setAppState('inactive');
    expect(track.mock.calls.filter(([name]) => name === 'user_engagement')).toHaveLength(1);
  });

  it('sends the queue as the app goes to background, after the engagement', async () => {
    const { Screen, session } = await mount();
    render(<Screen pathname="/home" />);
    setAppState('active'); // the session is shared: a test before may have left it backgrounded
    session.flush();

    setAppState('background');

    expect(sendPendingEvents).toHaveBeenCalledTimes(1);
    const engagement = track.mock.invocationCallOrder.at(-1) ?? 0;
    expect(sendPendingEvents.mock.invocationCallOrder[0]).toBeGreaterThan(engagement);
    // Not again while it stays in the background.
    setAppState('inactive');
    expect(sendPendingEvents).toHaveBeenCalledTimes(1);
  });

  it('backgrounded time is not engagement; returning to foreground resumes the clock', async () => {
    const { Screen, session } = await mount();
    render(<Screen pathname="/home" />);
    session.flush();

    vi.useFakeTimers();
    setAppState('background'); // 0ms accrued — no user_engagement event at all
    expect(track.mock.calls.filter(([name]) => name === 'user_engagement')).toHaveLength(0);

    vi.advanceTimersByTime(60_000); // a minute in the background
    setAppState('active');
    vi.advanceTimersByTime(3000); // three foreground seconds
    setAppState('background');
    vi.useRealTimers();

    const engagements = track.mock.calls.filter(([name]) => name === 'user_engagement');
    expect(engagements).toHaveLength(1);
    expect(engagements[0][1].engagement_time_msec).toBeLessThan(60_000);
    expect(engagements[0][1].engagement_time_msec).toBeGreaterThanOrEqual(3000);
  });

  it('removes the AppState subscription on unmount', async () => {
    const { Screen } = await mount();
    const { unmount } = render(<Screen pathname="/home" />);
    unmount();
    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});
