import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIosIdForVendorAsync, getAndroidId, getInstallReferrerAsync } from 'expo-application';
import { randomUUID } from 'expo-crypto';
import {
  osName,
  osVersion,
  modelName,
  deviceType,
  DeviceType,
  manufacturer,
  modelId,
} from 'expo-device';
import { getCalendars, getLocales } from 'expo-localization';
import { getAdvertisingId } from 'expo-tracking-transparency';
import { Platform, PixelRatio, Dimensions } from 'react-native';
import { URLSearchParams } from 'react-native-url-polyfill';
import type { Storage } from '../setup/index';
import type { TrackTags } from '../track/types';

export const storage: Storage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

export async function getDeviceId(): Promise<string> {
  let deviceId: string | null = null;
  if (Platform.OS === 'ios') {
    deviceId = await getIosIdForVendorAsync();
  } else if (Platform.OS === 'android') {
    deviceId = getAndroidId();
  }
  if (!deviceId) {
    deviceId = await AsyncStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = randomUUID();
      await AsyncStorage.setItem('device_id', deviceId);
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
  const height = Math.floor(screen.height);
  const width = Math.floor(screen.width);
  const params = new URLSearchParams(await getInstallReferrerAsync());

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
    device_pixel_ratio: `${PixelRatio.get()}`,
    screen_width: height,
    screen_height: width,
    screen_resolution: `${height}x${width}`,
    release: release,
    language: getLocales()?.[0]?.languageTag ?? 'en',
    time_zone: getCalendars()?.[0]?.timeZone ?? 'UTC',
    environment: __DEV__ ? 'development' : 'production',
    source: 'app',
    // ads
    advertising_id: getAdvertisingId() ?? undefined,
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
