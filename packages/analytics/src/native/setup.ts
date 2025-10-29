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
import type { Storage } from '../setup/index';
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

export async function getDeviceId(): Promise<string> {
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

export async function getTags(release: string): Promise<TrackTags> {
  const screen = Dimensions.get('screen');
  const screen_width = Math.floor(screen.width);
  const screen_height = Math.floor(screen.height);

  const install_referrer = Platform.OS === 'android' ? await getInstallReferrerAsync() : undefined;
  const params = new URLSearchParams(install_referrer);

  return {
    os: `${osName} ${osVersion}`,
    os_name: osName ?? undefined,
    os_version: osVersion ?? undefined,
    platform: Platform.OS,
    device: modelName ?? undefined,
    device_id: await getDeviceId(),
    device_type: getDeviceType(),
    device_vendor: manufacturer ?? undefined,
    device_model_id: modelId ?? undefined,
    device_pixel_ratio: PixelRatio.get(),
    screen_width,
    screen_height,
    screen_resolution: `${screen_width}x${screen_height}`,
    release: release,
    language: getLocales()?.[0]?.languageTag ?? 'en',
    time_zone: getCalendars()?.[0]?.timeZone ?? 'UTC',
    environment: __DEV__ ? 'development' : 'production',
    source: 'app',
    // ads
    advertising_id: getAdvertisingId() ?? undefined,
    install_referrer,
    // utm params
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
}
