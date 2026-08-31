import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getIosIdForVendorAsync = vi.fn(async () => 'ios-vendor-id');
const getInstallReferrerAsync = vi.fn(
  async () => 'utm_source=google-play&utm_medium=organic&gclid=G1'
);

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-application', () => ({
  getAndroidId: () => 'android-id',
  getIosIdForVendorAsync,
  getInstallReferrerAsync,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'random-uuid' }));
vi.mock('expo-device', () => ({
  DeviceType: { PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4, UNKNOWN: 0 },
  deviceType: 1,
  manufacturer: 'Apple',
  modelId: 'iPhone17,1',
  modelName: 'iPhone 16 Pro',
  osName: 'iOS',
  osVersion: '19.0',
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
  getCalendars: () => [{ timeZone: 'America/New_York' }],
}));
vi.mock('expo-tracking-transparency', () => ({ getAdvertisingId: () => 'idfa-1' }));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Dimensions: { get: () => ({ width: 390.5, height: 844.4 }) },
  PixelRatio: { get: () => 3 },
}));
vi.mock('react-native-url-polyfill', () => ({ URLSearchParams }));

// localStorage for the device-id fallback path; the expo shim install is mocked away.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

async function load() {
  const { baseOptions } = await import('../test/setup');
  const { setupAnalytics } = await import('../setup/index');
  setupAnalytics(baseOptions({ platform: 'android' }));
  return import('./setup');
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
});

afterEach(() => {
  vi.resetModules(); // the memoized promises live in module scope
});

describe('getTags', () => {
  it('assembles device, locale and install-referrer utm tags', async () => {
    const { getTags } = await load();
    const tags = await getTags();

    expect(tags).toMatchObject({
      os: 'iOS 19.0',
      device: 'iPhone 16 Pro',
      device_type: 'mobile',
      device_pixel_ratio: 3,
      screen_width: 390, // floored
      screen_resolution: '390x844',
      language: 'en-US',
      time_zone: 'America/New_York',
      advertising_id: 'idfa-1',
      utm_source: 'google-play',
      utm_medium: 'organic',
    });
  });

  it('resolves the install referrer once and reuses the promise', async () => {
    const { getTags } = await load();
    await getTags();
    await getTags();
    await getTags();

    expect(getInstallReferrerAsync).toHaveBeenCalledTimes(1);
  });

  it('retries the install referrer after a failure instead of caching it', async () => {
    const { getTags } = await load();
    getInstallReferrerAsync.mockRejectedValueOnce(new Error('play services not ready'));

    await expect(getTags()).rejects.toThrow('play services not ready');
    await expect(getTags()).resolves.toMatchObject({ utm_source: 'google-play' });
    expect(getInstallReferrerAsync).toHaveBeenCalledTimes(2);
  });
});

describe('getDeviceId', () => {
  it('memoizes across calls', async () => {
    const { getDeviceId } = await load();
    const [a, b] = await Promise.all([getDeviceId(), getDeviceId()]);
    expect(a).toBe('android-id');
    expect(b).toBe(a);
  });
});
