// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('../track/index', () => ({ track, sendBeacon: vi.fn() }));

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
});

describe('useAppAnalytics', () => {
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
