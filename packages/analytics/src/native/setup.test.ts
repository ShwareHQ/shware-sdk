import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { memoryStorage } from '../test/setup';

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

describe('install referrer utm', () => {
  async function loadWith(storage: ReturnType<typeof memoryStorage>) {
    const { baseOptions } = await import('../test/setup');
    const { setupAnalytics } = await import('../setup/index');
    setupAnalytics(baseOptions({ platform: 'android', storage }));
    const { getTags } = await import('./setup');
    return getTags;
  }

  it('is claimed by the first launch to build tags, and kept for that process', async () => {
    const { memoryStorage } = await import('../test/setup');
    const storage = memoryStorage();
    const getTags = await loadWith(storage);

    await expect(getTags()).resolves.toMatchObject({ utm_source: 'google-play' });
    expect(storage.map.get('install_referrer_claimed_time')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Later events of the same launch, and the visitor created from it, carry the utm too.
    await expect(getTags()).resolves.toMatchObject({ utm_source: 'google-play' });
  });

  it('is left off every launch after the one that claimed it', async () => {
    const { memoryStorage } = await import('../test/setup');
    const storage = memoryStorage();
    await (
      await loadWith(storage)
    )();

    // A new process over the same storage: the next launch of the same install.
    vi.resetModules();
    const tags = await (await loadWith(storage))();

    // The referrer itself still travels; only its spread into the session's utm stops.
    expect(tags.install_referrer).toBe('utm_source=google-play&utm_medium=organic&gclid=G1');
    expect(tags.utm_source).toBeUndefined();
    expect(tags.utm_medium).toBeUndefined();
  });

  it('is claimed again once storage is gone, as after a reinstall', async () => {
    const { memoryStorage } = await import('../test/setup');
    await (
      await loadWith(memoryStorage())
    )();

    vi.resetModules();
    await expect((await loadWith(memoryStorage()))()).resolves.toMatchObject({
      utm_source: 'google-play',
    });
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
