import type * as Application from 'expo-application';
import type * as Clipboard from 'expo-clipboard';
import type * as Device from 'expo-device';
import type * as Localization from 'expo-localization';
import type * as Native from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeterministicFingerprint, getProbabilisticFingerprint } from './fingerprint';

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
  'manufacturer' | 'modelId' | 'modelName' | 'osName' | 'osVersion' | 'supportedCpuArchitectures'
>;

const { state, getStringAsync } = vi.hoisted(() => {
  const initial: {
    os: typeof Native.Platform.OS;
    referrer: Awaited<ReturnType<typeof Application.getInstallReferrerAsync>>;
  } = { os: 'android', referrer: '' };
  return {
    state: initial,
    getStringAsync: vi.fn<typeof Clipboard.getStringAsync>(async () => 'https://shware.io/?s=abc'),
  };
});

vi.mock<Pick<typeof Application, 'getInstallReferrerAsync'>>(import('expo-application'), () => ({
  getInstallReferrerAsync: async () => state.referrer,
}));
vi.mock<Pick<typeof Clipboard, 'getStringAsync'>>(import('expo-clipboard'), () => ({
  getStringAsync,
}));
vi.mock<DevicePort>(import('expo-device'), () => ({
  manufacturer: 'Google',
  modelId: 'Pixel9',
  modelName: 'Pixel 9',
  osName: 'Android',
  osVersion: '16',
  supportedCpuArchitectures: ['arm64-v8a'],
}));
vi.mock<LocalizationPort>(import('expo-localization'), () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
  getCalendars: () => [{ timeZone: 'America/New_York' }],
}));
vi.mock<NativePort>(import('react-native'), () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
  Dimensions: { get: () => ({ width: 411.4, height: 914.6 }) },
  PixelRatio: { get: () => 2.6 },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.os = 'android';
  state.referrer = '';
});

describe('getDeterministicFingerprint', () => {
  it('extracts the click id from the android install referrer', async () => {
    state.referrer = 'utm_source=meta&click_id=CLK1';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: 'CLK1' });
  });

  it('answers null when the referrer has no click id, or there is no referrer', async () => {
    state.referrer = 'utm_source=meta';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: null });

    state.referrer = '';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: null });
  });

  it('never reads the referrer on iOS', async () => {
    state.os = 'ios';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: null });
  });
});

describe('getProbabilisticFingerprint', () => {
  it('assembles the device profile, floored screen and pasted link', async () => {
    state.referrer = 'utm_source=meta';
    const fp = await getProbabilisticFingerprint();

    expect(fp).toMatchObject({
      os: 'Android 16',
      os_name: 'Android',
      cpu_architecture: 'arm64-v8a',
      platform: 'android',
      device: 'Pixel 9',
      device_vendor: 'Google',
      device_model_id: 'Pixel9',
      device_pixel_ratio: 2.6,
      screen_width: 411,
      screen_height: 914,
      screen_resolution: '411x914',
      language: 'en-US',
      time_zone: 'America/New_York',
      install_referrer: 'utm_source=meta',
      pasted_link: 'https://shware.io/?s=abc',
    });
    expect(fp.timestamp).toBeGreaterThan(0);
  });

  it('leaves the clipboard untouched when asked not to read it', async () => {
    const fp = await getProbabilisticFingerprint(false);
    expect(getStringAsync).not.toHaveBeenCalled();
    expect(fp.pasted_link).toBeNull();
  });
});
