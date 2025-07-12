import type { StandardEvents, UserProvidedData as GAUserProvidedData } from './gtag';

export type AllowedPropertyValues = string | number | boolean | null;
export type EventName = Lowercase<string> | 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

export type TrackName<T extends EventName = EventName> = T extends keyof StandardEvents
  ? T
  : EventName;
export type TrackProperties<T extends EventName = EventName> = T extends keyof StandardEvents
  ? StandardEvents[T]
  : Record<Lowercase<string>, AllowedPropertyValues>;

export interface UserData {
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
}

export interface UserProvidedData extends GAUserProvidedData {
  user_id?: string;
  ip_address?: string;
  user_agent?: string;
  gender?: 'female' | 'male';
  birthday?: { year: number; month: number; day: number };
  // meta specific
  fb_login_id?: string;
  fb_page_id?: string;
}

export type ThirdPartyTracker = <T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  event_id?: string
) => void;

export interface PlatformInfo {
  os?: string;
  os_name?: string;
  os_version?: string;
  browser?: string;
  browser_name?: string;
  browser_version?: string;
  platform?: 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux' | 'unknown';
}

export interface DeviceInfo {
  device?: string;
  device_id?: string;
  device_type?: string;
  device_vendor?: string;
  device_model_id?: string;
  device_pixel_ratio?: string;
  screen_width?: number;
  screen_height?: number;
  screen_resolution?: `${number}x${number}`;
}

export interface AppInfo {
  install_referrer?: string;
}

export interface EnvironmentInfo {
  release?: string;
  language?: string;
  time_zone?: string | null;
  environment?: 'development' | 'production';
}

export interface SourceInfo {
  source_url?: string;
  source?: 'app' | 'web' | 'offline';
}

export interface AdvertisingInfo {
  /**
   * Meta pixel fields
   * ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters#fbc
   * Stored in the _fbc/_fbp browser cookie under your domain
   * ref: https://www.facebook.com/business/help/2360940870872492?checkpoint_src=any
   */
  fbc?: string;
  fbp?: string;
  fbclid?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  placement?: string;
  site_source_name?: string;
  /**
   * Google Analytics fields
   */
  gclid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  /** iOS: IDFA, Android: Android Advertising ID */
  advertising_id?: string;
}

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface TrackTags
  extends PlatformInfo,
    DeviceInfo,
    AppInfo,
    EnvironmentInfo,
    SourceInfo,
    AdvertisingInfo,
    UTMParams {
  idempotency_key?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export type CreateTrackEventDTO<T extends EventName = EventName> = {
  name: TrackName<T>;
  tags: TrackTags;
  visitor_id: string;
  properties?: TrackProperties<T>;
  timestamp: string;
}[];

export interface TrackEvent<T extends EventName = EventName> {
  id: string;
  name: TrackName<T>;
  tags: TrackTags;
  visitor_id: string;
  properties?: TrackProperties<T>;
  created_at: string;
}

export type TrackEventResponse = {
  /**
   * track event id
   * some tracking system will use event_id and event_name for deduplication
   * */
  id: string;
}[];
