import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logEvent, setUserId, odmEmail, odmPhone, logFBEvent, setUserID, setUserData } = vi.hoisted(
  () => ({
    odmEmail: vi.fn<(analytics: unknown, email: string) => Promise<void>>(() => Promise.resolve()),
    odmPhone: vi.fn<(analytics: unknown, phone: string) => Promise<void>>(() => Promise.resolve()),
    setUserID: vi.fn<(id: string | null) => void>(),
    setUserData: vi.fn<(data: object) => void>(),
    logEvent: vi.fn<(analytics: unknown, name: string, params?: object) => void>(),
    setUserId: vi.fn<(analytics: unknown, id: string | null) => Promise<void>>(() =>
      Promise.resolve()
    ),
    logFBEvent: vi.fn<(name: string, params?: object) => void>(),
  })
);
vi.mock(import('@react-native-firebase/analytics'), () => ({
  getAnalytics: (() => ({})) as never,
  logEvent: logEvent as never,
  setUserId: setUserId as never,
  initiateOnDeviceConversionMeasurementWithEmailAddress: odmEmail as never,
  initiateOnDeviceConversionMeasurementWithPhoneNumber: odmPhone as never,
}));
vi.mock(import('react-native-fbsdk-next'), () => ({
  AppEventsLogger: { logEvent: logFBEvent, setUserID, setUserData } as never,
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

  it('sets the user id on identify and clears it on reset', () => {
    const { setUser } = firebaseAnalytics();
    setUser?.({ user_id: 'u1' });
    expect(setUserId).toHaveBeenLastCalledWith(expect.anything(), 'u1');

    setUser?.({});
    expect(setUserId).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(odmEmail).not.toHaveBeenCalled();
    expect(odmPhone).not.toHaveBeenCalled();
  });

  it('hands the email and phone number to on-device conversion measurement', () => {
    firebaseAnalytics().setUser?.({
      user_id: 'u1',
      user_data: { email: ['a@b.co', 'x@y.z'], phone_number: '+14155551234' },
    });
    expect(odmEmail).toHaveBeenCalledWith(expect.anything(), 'a@b.co');
    expect(odmPhone).toHaveBeenCalledWith(expect.anything(), '+14155551234');
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

  it('hands the user id and matching fields over, and clears them on reset', () => {
    const { setUser } = metaAppEvents();
    setUser?.({
      user_id: 'u1',
      user_data: { email: ['a@b.co'], address: { first_name: 'Ada', region: 'CA' } },
    });
    expect(setUserID).toHaveBeenLastCalledWith('u1');
    expect(setUserData).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: 'a@b.co', firstName: 'Ada', state: 'CA' })
    );

    setUser?.({});
    expect(setUserID).toHaveBeenLastCalledWith(null);
    expect(setUserData).toHaveBeenLastCalledWith(expect.objectContaining({ email: undefined }));
  });
});
