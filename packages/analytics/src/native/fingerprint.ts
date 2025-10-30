/**
 * reference: https://docs.swmansion.com/detour/docs/Architecture/matching
 *
 */
import { getInstallReferrerAsync } from 'expo-application';
import { getStringAsync } from 'expo-clipboard';
import {
  manufacturer,
  modelId,
  modelName,
  osName,
  osVersion,
  supportedCpuArchitectures,
} from 'expo-device';
import { getCalendars, getLocales } from 'expo-localization';
import { Dimensions, PixelRatio, Platform } from 'react-native';

// used when install referrer on android is available
export type DeterministicFingerprint = {
  click_id: string | null;
};

export type ProbabilisticFingerprint = {
  os: string | null;
  os_name: string | null;
  os_version: string | null;
  cpu_architecture: string | null;
  platform: 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux' | 'unknown';
  device: string | null;
  device_vendor: string | null;
  device_model_id: string | null;
  device_pixel_ratio: number;
  screen_width: number;
  screen_height: number;
  screen_resolution: string;
  language: string | null;
  time_zone: string | null;
  install_referrer: string | null;
  pasted_link: string | null;
  timestamp: number; // 7 days validity
};

export async function getDeterministicFingerprint(): Promise<DeterministicFingerprint> {
  const install_referrer = Platform.OS === 'android' ? await getInstallReferrerAsync() : null;
  if (!install_referrer) return { click_id: null };
  const params = new URLSearchParams(install_referrer);
  return { click_id: params.get('click_id') ?? null };
}

export async function getProbabilisticFingerprint(
  shouldUseClipboard: boolean = true
): Promise<ProbabilisticFingerprint> {
  const screen = Dimensions.get('screen');
  const screen_width = Math.floor(screen.width);
  const screen_height = Math.floor(screen.height);
  const install_referrer = Platform.OS === 'android' ? await getInstallReferrerAsync() : null;

  return {
    os: osName && osVersion ? `${osName} ${osVersion}` : null,
    os_name: osName,
    os_version: osVersion,
    cpu_architecture: supportedCpuArchitectures?.at(0) ?? null,
    platform: Platform.OS,
    device: modelName,
    device_vendor: manufacturer,
    device_model_id: modelId,
    device_pixel_ratio: PixelRatio.get(),
    screen_width,
    screen_height,
    screen_resolution: `${screen_width}x${screen_height}`,
    language: getLocales()?.[0]?.languageTag ?? null,
    time_zone: getCalendars()?.[0]?.timeZone ?? null,
    install_referrer,
    pasted_link: shouldUseClipboard ? await getStringAsync() : null,
    timestamp: Date.now(),
  };
}
