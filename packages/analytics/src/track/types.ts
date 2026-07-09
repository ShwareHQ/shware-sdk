import type { UserProvidedData as GAUserProvidedData, StandardEvents } from './gtag';

export type AllowedPropertyValues = string | number | boolean | null;
export type EventName = Lowercase<string> | 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

export type TrackName<T extends EventName = EventName> = T extends keyof StandardEvents
  ? T
  : EventName;
export type TrackProperties<T extends EventName = EventName> = T extends keyof StandardEvents
  ? StandardEvents[T]
  : Record<Lowercase<string>, AllowedPropertyValues>;

export type Platform = 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux' | 'unknown';
export type Environment = 'development' | 'production';

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
  /** @deprecated */
  platform: Platform;
}

export interface DeviceInfo {
  device?: string;
  device_id?: string;
  device_type?: string;
  device_vendor?: string;
  device_model_id?: string;
  device_pixel_ratio?: number;
  screen_width?: number;
  screen_height?: number;
  screen_resolution?: `${number}x${number}`;
}

export interface AppInfo {
  /** iOS: IDFA, Android: Android Advertising ID */
  advertising_id?: string;
  install_referrer?: string;
}

export interface EnvironmentInfo {
  release?: string;
  language?: string;
  time_zone?: string;
  /** @deprecated */
  environment: Environment;
}

export interface SourceInfo {
  source_url?: string;
  source?: 'app' | 'web' | 'offline';
  page_referrer?: string;
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
  /** Google Analytics fields */
  gclid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  /** Reddit Ads fields */
  rdt_cid?: string;
  rdt_uuid?: string;
  /** LinkedIn Ads fields: get click id from url params or first-party cookie */
  li_fat_id?: string;
  // click ids
  dclid?: string; // Google Display Network
  ko_click_id?: string; // Kakao Ads
  msclkid?: string; // Microsoft Ads (Bing Ads)
  sccid?: string; // Snapchat Ads
  ttclid?: string; // TikTok Ads
  twclid?: string; // Twitter Ads (X Ads)
  wbraid?: string; // Google Ads (for iOS privacy)
  yclid?: string; // Yandex Ads
}

/**
 * UTM campaign parameters.
 * Value unions follow GA4 default channel group definitions:
 * https://support.google.com/analytics/answer/9756891
 */
export interface UTMParams {
  /** Referrer of the traffic, matched against GA4 source lists (search/social/video/shopping sites) */
  utm_source?:
    | 'google'
    | 'bing'
    | 'baidu'
    | 'duckduckgo'
    | 'yahoo'
    | 'yandex'
    | 'meta'
    | 'facebook'
    | 'instagram'
    | 'twitter'
    | 'x'
    | 'linkedin'
    | 'tiktok'
    | 'pinterest'
    | 'reddit'
    | 'snapchat'
    | 'youtube'
    | 'vimeo'
    | 'twitch'
    | 'newsletter'
    | 'email'
    | 'sms'
    | 'firebase' // Mobile Push Notifications: source exactly matches "firebase"
    | '(direct)' // Direct: with medium "(none)" / "(not set)"
    | (string & {});
  /**
   * Marketing medium, the primary input for GA4 channel classification:
   * - Paid *:  `^(.*cp.*|ppc|retargeting|paid.*)$`
   * - Display: `^(display|banner|expandable|interstitial|cpm)$`
   * - Organic Social: `^(social|social-network|social-media|sm|social network|social media)$`
   * - Organic Video: `^(.*video.*)$`
   * - Organic Search: `organic`
   * - Referral: `^(referral|app|link)$`
   * - Email: `email|e-mail|e_mail|e mail`
   * - Mobile Push: `^(.*(mobile|notification).*|push$)`
   */
  utm_medium?:
    // Paid: ^(.*cp.*|ppc|retargeting|paid.*)$
    | 'cpc'
    | 'cpm'
    | 'cpv'
    | 'cpa'
    | 'ppc'
    | 'retargeting'
    | `${string}cp${string}`
    | `paid${string}`
    // Display
    | 'display'
    | 'banner'
    | 'expandable'
    | 'interstitial'
    // Organic Social
    | 'social'
    | 'social-network'
    | 'social-media'
    | 'sm'
    | 'social network'
    | 'social media'
    // Organic Video: ^(.*video.*)$
    | 'video'
    | `${string}video${string}`
    // Organic Search
    | 'organic'
    // Referral
    | 'referral'
    | 'app'
    | 'link'
    // Email
    | 'email'
    | 'e-mail'
    | 'e_mail'
    | 'e mail'
    // Affiliates
    | 'affiliate'
    // Audio
    | 'audio'
    // SMS
    | 'sms'
    // Mobile Push Notifications: ^(.*(mobile|notification).*|push$)
    | `${string}push`
    | `${string}mobile${string}`
    | `${string}notification${string}`
    // Direct
    | '(none)'
    | '(not set)'
    | (string & {});
  /**
   * Campaign name. GA4 special cases:
   * - Cross-network: contains "cross-network"
   * - Shopping: `^(.*(([^a-df-z]|^)shop|shopping).*)$`
   */
  utm_campaign?:
    | `${string}cross-network${string}`
    | `${string}shop${string}`
    | `${string}shopping${string}`
    | (string & {});
  /** Paid keyword of the campaign */
  utm_term?: string;
  /** Used to differentiate creatives/links pointing to the same URL */
  utm_content?: string;
  /** Campaign ID (maps to the GA4 "campaign id" dimension) */
  utm_id?: string;
  /** Platform responsible for directing the traffic */
  utm_source_platform?:
    | 'Manual'
    | 'Google Ads'
    | 'DV360'
    | 'CM360'
    | 'SA360'
    | 'SFMC'
    | 'Shopping Free Listings'
    | (string & {});
  /** Type of the creative */
  utm_creative_format?: 'display' | 'native' | 'video' | 'search' | (string & {});
  /** Targeting criteria applied to the campaign */
  utm_marketing_tactic?: 'remarketing' | 'prospecting' | (string & {});
}

export interface TrackTags
  extends
    PlatformInfo,
    DeviceInfo,
    AppInfo,
    EnvironmentInfo,
    SourceInfo,
    AdvertisingInfo,
    UTMParams {
  idempotency_key?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface TrackEvent<T extends EventName = EventName> {
  id: string;
  name: TrackName<T>;
  tags: TrackTags;
  visitor_id: string;
  session_id: string;
  platform: Platform;
  environment: Environment;
  properties?: TrackProperties<T>;
  created_at: string;
}

export type TrackEventResponse = {
  /** track event id: Meta Pixel will use event_id and event_name for deduplication */
  id: string;
}[];
