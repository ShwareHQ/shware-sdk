import type { UserProvidedData as GAUserProvidedData, StandardEvents } from './gtag';

export type AllowedPropertyValues = string | number | boolean | null;
export type EventName = Lowercase<string> | 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

export type TrackName<T extends EventName = EventName> = T extends keyof StandardEvents
  ? T
  : EventName;

/**
 * Properties an application defines for its own events, keyed by event name.
 *
 * Empty here on purpose. Applications fill it by declaration merging, and it does two jobs:
 * it adds custom properties to GA4's standard events, which are otherwise closed shapes and
 * would need a cast; and it gives an application's own events a real type instead of the
 * open record they fall back to.
 *
 * ```ts
 * declare module '@shware/analytics' {
 *   interface CustomEventProperties {
 *     // Extra properties on a standard event.
 *     begin_checkout: { type?: 'new_purchase' | 'upgrade' };
 *     // The whole shape of an event this app defines itself.
 *     schedule_plan_change: { direction: 'upgrade' | 'downgrade'; effective_at: string };
 *   }
 * }
 * ```
 *
 * Keyed by event rather than a single flat set of properties, so a dimension cannot leak
 * onto events it means nothing on. An event nobody declares keeps its previous type exactly,
 * which is what makes adopting this optional and incremental.
 *
 * Note what "custom" attaches to: the *properties*, not the event. `begin_checkout` is one
 * of GA4's recommended events and stays one — only the properties added here are custom.
 */
// Empty is the point: this is an extension point, and any member declared here would be
// forced on every application that merges into it.
// oxlint-disable-next-line typescript/no-empty-object-type
export interface CustomEventProperties {}

/**
 * An application's declared properties for one event, or nothing if it declared none.
 *
 * `unknown` rather than `{}` for the empty case: it is the identity of `&`, so an event with
 * no declaration intersects to exactly the type it had before.
 */
type CustomPropertiesFor<T> = T extends keyof CustomEventProperties
  ? CustomEventProperties[T]
  : unknown;

export type TrackProperties<T extends EventName = EventName> = T extends keyof StandardEvents
  ? StandardEvents[T] & CustomPropertiesFor<T>
  : T extends keyof CustomEventProperties
    ? CustomEventProperties[T]
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
  /** Web only, and only when true: `navigator.webdriver`, set by a browser under automation. */
  webdriver?: boolean;
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
}

/**
 * Page context, captured when the event happens rather than when its batch is sent, and named
 * after the GA4 parameters it mirrors — gtag sends `page_location`, `page_referrer` and
 * `page_title` with every event, not just with `page_view`.
 *
 * Web only: a native app has no page. Meta's `event_source_url` and OpenAI's `source_url` are
 * both fed from `page_location`.
 */
export interface PageInfo {
  page_location?: string;
  page_referrer?: string;
  page_title?: string;
  /**
   * Identifies one page load: every event of a page carries the same id, and a navigation — a
   * reload, or a single-page-app route change, the same moments a `page_view` is sent — starts
   * a new one. Lets a server-side sender tie a conversion to the page load it happened on
   * (Microsoft's `pageLoadId`). Web only.
   */
  page_load_id?: string;
  /**
   * @deprecated Renamed to `page_location` in 7.0.0, and never set by this SDK any more.
   * Declared so events from clients still on an older version keep their page URL through
   * validation; read it through `pageLocation` rather than directly.
   */
  source_url?: string;
}

/**
 * Ad click ids and the ad platforms' first-party cookies, each under the name of where it was
 * read: a URL parameter keeps the parameter's own name (`fbclid`, `gclid`, `ScCid` — jsonb keys
 * are case-sensitive, so in SQL that is `tags->>'ScCid'`), a cookie keeps the cookie's name and
 * so starts with an underscore (`_fbc`, `_gcl_aw`, `__oppref`). One source per key, never a
 * fallback from one to the other, so a value always says where it came from.
 *
 * The URL parameters are this page's click and name the visit's channel (`CLICK_ID_CHANNELS`);
 * the cookies outlive the click and only ever feed the conversion senders, which take the URL
 * parameter first and the cookie when the page carries none (`server/click-ids`).
 */
export interface AdvertisingInfo {
  // Meta Ads. `ad_id` … `placement` are our own landing-URL template parameters.
  fbclid?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  placement?: string;
  /**
   * Meta click id cookie, `fb.<subdomainIndex>.<creationTime>.<fbclid>`, set server-side by
   * `resolveClickIdCookies`.
   * ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
   */
  _fbc?: string;
  /** Meta browser id cookie, `fb.<subdomainIndex>.<creationTime>.<random>`, set by the pixel. */
  _fbp?: string;
  /** @deprecated Renamed to `_fbc` in 9.0.0; still read from clients on an older version. */
  fbc?: string;
  /** @deprecated Renamed to `_fbp` in 9.0.0; still read from clients on an older version. */
  fbp?: string;
  // Google Ads
  gclid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  wbraid?: string; // web-to-app (iOS, post-ATT)
  gbraid?: string; // app-to-web (iOS, post-ATT)
  dclid?: string; // Display & Video 360
  /** gtag's click cookie, `GCL.<seconds>.<gclid>`; see `parseGcl`. */
  _gcl_aw?: string;
  /** gtag's web-to-app click cookie, `GCL.<seconds>.<wbraid>`; see `parseGcl`. */
  _gcl_gb?: string;
  // Microsoft Ads
  msclkid?: string;
  /** The UET tag's click cookie, `_uet<msclkid>`; see `parseUetMsclkid`. */
  _uetmsclkid?: string;
  // Reddit Ads
  rdt_cid?: string;
  /** Reddit click id cookie, set server-side by `resolveClickIdCookies`. */
  _rdt_cid?: string;
  /** The Reddit pixel's browser id cookie, `<timestamp>.<uuid>`. */
  _rdt_uuid?: string;
  /** @deprecated Renamed to `_rdt_uuid` in 9.0.0; still read from clients on an older version. */
  rdt_uuid?: string;
  // LinkedIn Ads
  li_fat_id?: string;
  /**
   * The Insight Tag's click cookie. The cookie itself is named `li_fat_id`, like the URL
   * parameter; the underscore is ours, to keep the two apart.
   */
  _li_fat_id?: string;
  // OpenAI (ChatGPT) Ads
  oppref?: string;
  /** The pixel's copy of the last `oppref`, kept 30 days. */
  __oppref?: string;
  /** The pixel's browser reference, a random id kept 365 days. */
  __obref?: string;
  // Other ad platforms
  ko_click_id?: string; // Kakao Ads
  ScCid?: string; // Snapchat Ads, spelled as Snapchat appends it
  ttclid?: string; // TikTok Ads
  twclid?: string; // Twitter Ads (X Ads)
  yclid?: string; // Yandex Ads
  epik?: string; // Pinterest Ads
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
  extends PlatformInfo, DeviceInfo, AppInfo, EnvironmentInfo, PageInfo, AdvertisingInfo, UTMParams {
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
