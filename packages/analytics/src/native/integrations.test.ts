import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logEvent, setUserId, logFBEvent } = vi.hoisted(() => ({
  logEvent: vi.fn<(analytics: unknown, name: string, params?: object) => void>(),
  setUserId: vi.fn<(analytics: unknown, id: string | null) => Promise<void>>(() =>
    Promise.resolve()
  ),
  logFBEvent: vi.fn<(name: string, params?: object) => void>(),
}));
vi.mock(import('@react-native-firebase/analytics'), () => ({
  getAnalytics: (() => ({})) as never,
  logEvent: logEvent as never,
  setUserId: setUserId as never,
}));
vi.mock(import('react-native-fbsdk-next'), () => ({
  AppEventsLogger: { logEvent: logFBEvent } as never,
}));

const { metaAppEvents } = await import('./fbsdk');
const { firebaseAnalytics } = await import('./firebase');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firebaseAnalytics', () => {
  it('is an analytics integration that logs every event', () => {
    const firebase = firebaseAnalytics();
    expect(firebase.type).toBe('analytics');

    firebase.track('onboarding_completed', undefined);
    expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'onboarding_completed', undefined);
  });

  it('sets the user id on identify, without the email, and clears it on reset', () => {
    const { setUser } = firebaseAnalytics();
    setUser?.({ user_id: 'u1', user_data: { email: 'a@b.co' } });
    expect(setUserId).toHaveBeenLastCalledWith(expect.anything(), 'u1');

    setUser?.({});
    expect(setUserId).toHaveBeenLastCalledWith(expect.anything(), null);
  });
});

describe('metaAppEvents', () => {
  it('logs the standard events and the listed custom ones only', () => {
    const meta = metaAppEvents({ customEvents: ['onboarding_completed'] });
    expect(meta.type).toBe('ads');

    meta.track('add_to_wishlist', { currency: 'USD', value: 1, items: [] });
    meta.track('onboarding_completed', undefined);
    meta.track('button_clicked', undefined);

    expect(logFBEvent).toHaveBeenCalledTimes(2);
    expect(logFBEvent.mock.calls.map(([name]) => name)).not.toContain('button_clicked');
  });
});
