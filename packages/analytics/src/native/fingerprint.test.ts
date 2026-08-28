import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeterministicFingerprint, getProbabilisticFingerprint } from './fingerprint';

const { state, getStringAsync } = vi.hoisted(() => ({
  state: {
    os: 'android',
    referrer: null as string | null,
  },
  getStringAsync: vi.fn(async () => 'https://shware.io/?s=abc'),
}));

vi.mock('expo-application', () => ({
  getInstallReferrerAsync: async () => state.referrer,
}));
vi.mock('expo-clipboard', () => ({ getStringAsync }));
vi.mock('expo-device', () => ({
  manufacturer: 'Google',
  modelId: 'Pixel9',
  modelName: 'Pixel 9',
  osName: 'Android',
  osVersion: '16',
  supportedCpuArchitectures: ['arm64-v8a'],
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
  getCalendars: () => [{ timeZone: 'America/New_York' }],
}));
vi.mock('react-native', () => ({
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
  state.referrer = null;
});

describe('getDeterministicFingerprint', () => {
  it('extracts the click id from the android install referrer', async () => {
    state.referrer = 'utm_source=meta&click_id=CLK1';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: 'CLK1' });
  });

  it('answers null when the referrer has no click id, or there is no referrer', async () => {
    state.referrer = 'utm_source=meta';
    await expect(getDeterministicFingerprint()).resolves.toEqual({ click_id: null });

    state.referrer = null;
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
