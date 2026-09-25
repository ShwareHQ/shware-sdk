import 'expo-sqlite/localStorage/install';
import { getAndroidId, getInstallReferrerAsync, getIosIdForVendorAsync } from 'expo-application';
import { randomUUID } from 'expo-crypto';
import {
  DeviceType,
  deviceType,
  manufacturer,
  modelId,
  modelName,
  osName,
  osVersion,
} from 'expo-device';
import { getCalendars, getLocales } from 'expo-localization';
import { getAdvertisingId } from 'expo-tracking-transparency';
import { Dimensions, PixelRatio, Platform } from 'react-native';
import { URLSearchParams } from 'react-native-url-polyfill';
import { keys } from '../constants/storage';
import { type Storage, cache, config } from '../setup/index';
import type { TrackTags } from '../track/types';

const map = new Map<string, string>();

export const storage: Storage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      console.error('localStorage is not available');
      return map.get(key) ?? null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      console.error('localStorage is not available');
      map.set(key, value);
    }
  },
};

/**
 * `getTags` runs once per event now, and both of these reach for a native module. Neither answer
 * can change while the app is running, so each is resolved once and the promise is reused. A
 * failed lookup is not cached, so the next event tries again.
 */
let deviceIdPromise: Promise<string> | undefined;
let installReferrerPromise: Promise<string | undefined> | undefined;

export function getDeviceId(): Promise<string> {
  deviceIdPromise ??= resolveDeviceId().catch((error: unknown) => {
    deviceIdPromise = undefined;
    throw error;
  });
  return deviceIdPromise;
}

function getInstallReferrer(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return Promise.resolve(undefined);
  installReferrerPromise ??= getInstallReferrerAsync().catch((error: unknown) => {
    installReferrerPromise = undefined;
    throw error;
  });
  return installReferrerPromise;
}

async function resolveDeviceId(): Promise<string> {
  let deviceId: string | null = null;
  if (Platform.OS === 'ios') {
    deviceId = await getIosIdForVendorAsync();
  } else if (Platform.OS === 'android') {
    deviceId = getAndroidId();
  }
  if (!deviceId) {
    deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = randomUUID();
      localStorage.setItem('device_id', deviceId);
    }
  }
  return deviceId;
}

export function getDeviceType(): string | undefined {
  switch (deviceType) {
    case DeviceType.PHONE:
      return 'mobile';
    case DeviceType.TABLET:
      return 'tablet';
    case DeviceType.DESKTOP:
      return 'desktop';
    case DeviceType.TV:
      return 'smarttv';
    default:
      return undefined;
  }
}

/**
 * The install referrer's utm belongs to one launch: the first one to build tags, which is the
 * install launch — `first_open` is the first event the app tracks, and tracking it is what builds
 * the first tags. That launch claims the referrer by writing a marker of its own, and the claim
 * is held in memory for the rest of the process, so every event of the install launch and the
 * visitor created from it carry the utm; every later launch finds the marker and sends the raw
 * `install_referrer` alone. Cleared storage and a reinstall lose the marker and claim again,
 * exactly as they make `first_open` fire again.
 *
 * A marker of its own rather than `first_open_time`, so that nothing here depends on when the
 * hook writes that one relative to the first `getTags`. The storage read waits for that call:
 * `setupAnalytics` and this module's evaluation can run where no storage exists.
 */
let installLaunch: boolean | undefined;

function claimInstallReferrer(): boolean {
  if (config.storage.getItem(keys.install_referrer_claimed_at)) return false;
  config.storage.setItem(keys.install_referrer_claimed_at, new Date().toISOString());
  return true;
}

export async function getTags(): Promise<TrackTags> {
  const screen = Dimensions.get('screen');
  const screen_width = Math.floor(screen.width);
  const screen_height = Math.floor(screen.height);

  // The install referrer never changes, and it used to be spread into `utm_*` on every launch —
  // so every session of an Android install reported the install campaign as its own acquisition
  // for as long as the app stayed installed, and a report reading a session's tags could not tell
  // the install from the thousandth open. The campaign is the install's touch, not every
  // session's.
  installLaunch ??= claimInstallReferrer();
  const install_referrer = await getInstallReferrer();
  const params = new URLSearchParams(installLaunch ? install_referrer : undefined);

  const tags: TrackTags = {
    os: `${osName} ${osVersion}`,
    os_name: osName ?? undefined,
    os_version: osVersion ?? undefined,
    device: modelName ?? undefined,
    device_id: await getDeviceId(),
    device_type: getDeviceType(),
    device_vendor: manufacturer ?? undefined,
    device_model_id: modelId ?? undefined,
    device_pixel_ratio: PixelRatio.get(),
    screen_width,
    screen_height,
    screen_resolution: `${screen_width}x${screen_height}`,
    release: config.release,
    language: getLocales().at(0)?.languageTag ?? 'en',
    time_zone: getCalendars().at(0)?.timeZone ?? 'UTC',
    // ads
    advertising_id: getAdvertisingId() ?? undefined,
    install_referrer,
    // utm params: from the install referrer, on the install launch only
    utm_source: params.get('utm_source') ?? undefined,
    utm_medium: params.get('utm_medium') ?? undefined,
    utm_campaign: params.get('utm_campaign') ?? undefined,
    utm_term: params.get('utm_term') ?? undefined,
    utm_content: params.get('utm_content') ?? undefined,
    utm_id: params.get('utm_id') ?? undefined,
    utm_source_platform: params.get('utm_source_platform') ?? undefined,
    utm_creative_format: params.get('utm_creative_format') ?? undefined,
    utm_marketing_tactic: params.get('utm_marketing_tactic') ?? undefined,
  };

  cache.tags = tags;
  return tags;
}
