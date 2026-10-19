import type * as Application from 'expo-application';
import type * as Crypto from 'expo-crypto';
import type * as Device from 'expo-device';
import type * as Localization from 'expo-localization';
import type * as TrackingTransparency from 'expo-tracking-transparency';
import type * as Native from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../setup/index';
import type { memoryStorage } from '../test/setup';

type LocalizationPort = {
  getLocales: () => Pick<ReturnType<typeof Localization.getLocales>[number], 'languageTag'>[];
  getCalendars: () => Pick<ReturnType<typeof Localization.getCalendars>[number], 'timeZone'>[];
};
type NativePort = {
  Platform: Pick<typeof Native.Platform, 'OS'>;
  Dimensions: {
    get: (
      dimension: Parameters<typeof Native.Dimensions.get>[0]
    ) => Pick<ReturnType<typeof Native.Dimensions.get>, 'width' | 'height'>;
  };
  PixelRatio: Pick<typeof Native.PixelRatio, 'get'>;
};
type DevicePort = Pick<
  typeof Device,
  'DeviceType' | 'deviceType' | 'manufacturer' | 'modelId' | 'modelName' | 'osName' | 'osVersion'
>;

const getIosIdForVendorAsync = vi.fn<typeof Application.getIosIdForVendorAsync>(
  async () => 'ios-vendor-id'
);
const getInstallReferrerAsync = vi.fn<typeof Application.getInstallReferrerAsync>(
  async () => 'utm_source=google-play&utm_medium=organic&gclid=G1'
);

vi.mock(import('expo-sqlite/localStorage/install'), () => ({}));
vi.mock<
  Pick<typeof Application, 'getAndroidId' | 'getIosIdForVendorAsync' | 'getInstallReferrerAsync'>
>(import('expo-application'), () => ({
  getAndroidId: () => 'android-id',
  getIosIdForVendorAsync,
  getInstallReferrerAsync,
}));
vi.mock<Pick<typeof Crypto, 'randomUUID'>>(import('expo-crypto'), () => ({
  randomUUID: () => 'random-uuid',
}));
vi.mock<DevicePort>(import('expo-device'), () => ({
  DeviceType: { PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4, UNKNOWN: 0 },
  deviceType: 1,
  manufacturer: 'Apple',
  modelId: 'iPhone17,1',
  modelName: 'iPhone 16 Pro',
  osName: 'iOS',
  osVersion: '19.0',
}));
vi.mock<LocalizationPort>(import('expo-localization'), () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
  getCalendars: () => [{ timeZone: 'America/New_York' }],
}));
vi.mock<Pick<typeof TrackingTransparency, 'getAdvertisingId'>>(
  import('expo-tracking-transparency'),
  () => ({ getAdvertisingId: () => 'idfa-1' })
);
vi.mock<NativePort>(import('react-native'), () => ({
  Platform: { OS: 'android' },
  Dimensions: { get: () => ({ width: 390.5, height: 844.4 }) },
  PixelRatio: { get: () => 3 },
}));

// localStorage for the device-id fallback path; the expo shim install is mocked away.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

async function load(overrides: Partial<Options> = {}) {
  const { baseOptions } = await import('../test/setup');
  const { setupAnalytics } = await import('../setup/index');
  setupAnalytics(baseOptions({ platform: 'android', ...overrides }));
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

  it('is claimed by the first launch that resolves the referrer, and kept for that process', async () => {
    const { memoryStorage } = await import('../test/setup');
    const storage = memoryStorage();
    const getTags = await loadWith(storage);

    await expect(getTags()).resolves.toMatchObject({ utm_source: 'google-play' });
    expect(storage.map.get('install_referrer_claim_time')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Later events of the same launch, and the visitor created from it, carry the utm too.
    await expect(getTags()).resolves.toMatchObject({ utm_source: 'google-play' });
  });

  it('is left off every launch after the one that claimed it', async () => {
    const { memoryStorage } = await import('../test/setup');
    const storage = memoryStorage();
    const installLaunch = await loadWith(storage);
    await installLaunch();

    // A new process over the same storage: the next launch of the same install.
    vi.resetModules();
    const laterLaunch = await loadWith(storage);
    const tags = await laterLaunch();

    // The referrer itself still travels; only its spread into the session's utm stops.
    expect(tags.install_referrer).toBe('utm_source=google-play&utm_medium=organic&gclid=G1');
    expect(tags.utm_source).toBeUndefined();
    expect(tags.utm_medium).toBeUndefined();
  });

  it('is not claimed by a launch that could not read the referrer, so a later one can', async () => {
    const { memoryStorage } = await import('../test/setup');
    const storage = memoryStorage();

    // Right after an install the Play Store service is often not reachable yet: this launch
    // fails to read the referrer and must leave the claim for a launch that can.
    getInstallReferrerAsync.mockRejectedValueOnce(new Error('play services not ready'));
    const offlineLaunch = await loadWith(storage);
    await expect(offlineLaunch()).rejects.toThrow('play services not ready');
    expect(storage.map.has('install_referrer_claim_time')).toBe(false);

    vi.resetModules();
    const laterLaunch = await loadWith(storage);
    await expect(laterLaunch()).resolves.toMatchObject({ utm_source: 'google-play' });
    expect(storage.map.has('install_referrer_claim_time')).toBe(true);
  });

  it('is claimed again once storage is gone, as after a reinstall', async () => {
    const { memoryStorage } = await import('../test/setup');
    const firstInstall = await loadWith(memoryStorage());
    await firstInstall();

    vi.resetModules();
    const reinstall = await loadWith(memoryStorage());
    await expect(reinstall()).resolves.toMatchObject({ utm_source: 'google-play' });
  });
});

describe('deepLink', () => {
  it("merges the app's opening link over the install referrer's utm", async () => {
    const { getTags } = await load({
      deepLink: {
        listen: () => undefined,
        getTags: () => ({ page_location: 'myapp://pricing', utm_source: 'lifecycle' }),
      },
    });

    await expect(getTags()).resolves.toMatchObject({
      page_location: 'myapp://pricing',
      utm_source: 'lifecycle', // over the referrer's google-play
      utm_medium: 'organic', // the referrer's, the link carrying none
      os: 'iOS 19.0',
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
