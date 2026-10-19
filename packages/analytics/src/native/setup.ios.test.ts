import type * as Application from 'expo-application';
import type * as Crypto from 'expo-crypto';
import type * as Device from 'expo-device';
import type * as Localization from 'expo-localization';
import type * as TrackingTransparency from 'expo-tracking-transparency';
import type * as Native from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
/**
 * The iOS/fallback side of native setup: the android path and the referrer memoization live in
 * setup.test.ts. A hoisted mutable state object backs the mocks so each test can re-shape the
 * device before re-importing the module graph.
 */

const state = vi.hoisted(() => {
  const initial: {
    os: typeof Native.Platform.OS;
    deviceType: typeof Device.deviceType;
    vendorId: Awaited<ReturnType<typeof Application.getIosIdForVendorAsync>>;
  } = {
    os: 'ios',
    deviceType: 2,
    vendorId: null,
  };
  return initial;
});

const getInstallReferrerAsync = vi.fn<typeof Application.getInstallReferrerAsync>(
  async () => 'utm_source=play'
);

vi.mock(import('expo-sqlite/localStorage/install'), () => ({}));
vi.mock<
  Pick<typeof Application, 'getAndroidId' | 'getIosIdForVendorAsync' | 'getInstallReferrerAsync'>
>(import('expo-application'), () => ({
  getAndroidId: () => 'android-id',
  getIosIdForVendorAsync: async () => state.vendorId,
  getInstallReferrerAsync,
}));
vi.mock<Pick<typeof Crypto, 'randomUUID'>>(import('expo-crypto'), () => ({
  randomUUID: () => 'random-uuid',
}));
vi.mock<DevicePort>(import('expo-device'), () => ({
  DeviceType: { PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4, UNKNOWN: 0 },
  get deviceType() {
    return state.deviceType;
  },
  manufacturer: 'Apple',
  modelId: 'iPad16,3',
  modelName: 'iPad Pro',
  osName: 'iPadOS',
  osVersion: '19.0',
}));
vi.mock<LocalizationPort>(import('expo-localization'), () => ({
  getLocales: () => [],
  getCalendars: () => [],
}));
vi.mock<Pick<typeof TrackingTransparency, 'getAdvertisingId'>>(
  import('expo-tracking-transparency'),
  () => ({ getAdvertisingId: () => null })
);
vi.mock<NativePort>(import('react-native'), () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
  Dimensions: { get: () => ({ width: 1024, height: 1366 }) },
  PixelRatio: { get: () => 2 },
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

async function load() {
  const { baseOptions } = await import('../test/setup');
  const { setupAnalytics } = await import('../setup/index');
  setupAnalytics(baseOptions({ platform: 'ios' }));
  return import('./setup');
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  state.os = 'ios';
  state.deviceType = 2;
  state.vendorId = null;
});

afterEach(() => {
  vi.resetModules();
});

describe('getDeviceId on iOS', () => {
  it('uses the vendor id when the OS provides one', async () => {
    state.vendorId = 'vendor-1';
    const { getDeviceId } = await load();
    await expect(getDeviceId()).resolves.toBe('vendor-1');
  });

  it('falls back to a generated id, persisted for the next launch', async () => {
    const { getDeviceId } = await load();
    await expect(getDeviceId()).resolves.toBe('random-uuid');
    expect(store.get('device_id')).toBe('random-uuid');
  });

  it('reuses the persisted fallback id instead of generating a new one', async () => {
    store.set('device_id', 'from-last-launch');
    const { getDeviceId } = await load();
    await expect(getDeviceId()).resolves.toBe('from-last-launch');
  });
});

describe('getTags on iOS', () => {
  it('never asks for the install referrer, and defaults locale fields', async () => {
    const { getTags } = await load();
    const tags = await getTags();

    expect(getInstallReferrerAsync).not.toHaveBeenCalled();
    expect(tags).toMatchObject({
      install_referrer: undefined,
      utm_source: undefined,
      language: 'en',
      time_zone: 'UTC',
      device_type: 'tablet',
      advertising_id: undefined,
    });
  });
});

describe('getDeviceType', () => {
  it.each([
    [1, 'mobile'],
    [2, 'tablet'],
    [3, 'desktop'],
    [4, 'smarttv'],
    [0, undefined],
  ] as const)('maps DeviceType %s to %s', async (deviceType, expected) => {
    state.deviceType = deviceType;
    const { getDeviceType } = await load();
    expect(getDeviceType()).toBe(expected);
    vi.resetModules();
  });
});

describe('storage', () => {
  it('falls back to in-memory storage when localStorage throws', async () => {
    const { storage } = await load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('sqlite not ready');
      },
      setItem: () => {
        throw new Error('sqlite not ready');
      },
    });

    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    error.mockRestore();
  });
});
