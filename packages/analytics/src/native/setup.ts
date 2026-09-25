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
 * Whether this process is the install launch — the one `first_open` is sent from.
 *
 * `first_open_time` is written by that launch, as an ISO timestamp. No marker means no launch has
 * sent `first_open` yet: this one is it. A marker means one has, and its timestamp tells which:
 * written within a minute of this process starting, it is this launch's own — the hook wrote it
 * before the first `getTags` ran, which the order of the two must be free to allow; written
 * further from it, in either direction, it belongs to an earlier launch. Cleared storage and a
 * reinstall read as an install launch, exactly as they make `first_open` fire again.
 *
 * A window rather than a one-sided bound because the two timestamps come from the same wall
 * clock and a clock correction can land between them either way: an NTP sync on a phone that
 * has just come online (when an install launch tends to happen) can pull the marker behind the
 * process start, and a clock that ran fast during an earlier launch and was set back since can
 * leave that launch's marker ahead of it. A minute bounds both. What it cannot tell apart is a
 * relaunch within that minute — a crash on the install launch and a retry — which reads as the
 * install launch again and repeats the utm once, on the same channel, in the same minute.
 *
 * `processStartedAt` is a plain number taken at import; the storage read waits for the first
 * `getTags`, because `setupAnalytics` and this module's evaluation can run where no storage
 * exists, and set-up must stay free of I/O.
 */
const processStartedAt = Date.now();
const CLOCK_TOLERANCE = 60 * 1000;
let installLaunch: boolean | undefined;

function isInstallLaunch(): boolean {
  const firstOpenTime = config.storage.getItem(keys.first_open_time);
  if (!firstOpenTime) return true;
  return Math.abs(Date.parse(firstOpenTime) - processStartedAt) <= CLOCK_TOLERANCE;
}

export async function getTags(): Promise<TrackTags> {
  const screen = Dimensions.get('screen');
  const screen_width = Math.floor(screen.width);
  const screen_height = Math.floor(screen.height);

  // The install referrer never changes, and it used to be spread into `utm_*` on every launch —
  // so every session of an Android install reported the install campaign as its own acquisition
  // for as long as the app stayed installed, and a report reading a session's tags could not tell
  // the install from the thousandth open. The campaign is the install's touch, not every
  // session's: the install launch carries it, on the visitor's initial_tags and on every event
  // of that launch, and later launches send the raw `install_referrer` alone.
  installLaunch ??= isInstallLaunch();
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
