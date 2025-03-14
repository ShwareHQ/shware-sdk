export const standardEventNames = [
  'add_payment_info',
  'add_shipping_info',
  'add_to_cart',
  'add_to_wishlist',
  'begin_checkout',
  'close_convert_lead',
  'close_unconvert_lead',
  'disqualify_lead',
  'earn_virtual_currency',
  'generate_lead',
  'join_group',
  'level_end',
  'level_start',
  'level_up',
  'login',
  'post_score',
  'purchase',
  'qualify_lead',
  'refund',
  'remove_from_cart',
  'search',
  'select_content',
  'select_item',
  'select_promotion',
  'share',
  'sign_up',
  'spend_virtual_currency',
  'tutorial_begin',
  'tutorial_complete',
  'unlock_achievement',
  'view_cart',
  'view_item',
  'view_item_list',
  'view_promotion',
  'working_lead',
] as const;

export const reservedEventNames = [
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'ad_query',
  'ad_reward',
  'adunit_exposure',
  'app_background',
  'app_clear_data',
  'app_exception',
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_convert',
  'app_store_subscription_renew',
  'app_update',
  'app_upgrade',
  'dynamic_link_app_open',
  'dynamic_link_app_update',
  'dynamic_link_first_open',
  'error',
  'first_open',
  'first_visit',
  'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'os_update',
  'session_start',
  'session_start_with_rollout',
  'user_engagement',
];

export interface Item {
  item_brand?: string;
  item_id?: string;
  item_name?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_location_id?: string;
  item_variant?: string;
  quantity?: number;
  price?: number;
}

/**
 * ref: https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag
 * ref: https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics.Event
 * */
export type StandardEventProperties = {
  // Google Analytics 4 Recommended Events
  add_payment_info: {
    items?: Item[];
    currency?: string;
    value?: number;
    coupon?: string;
    payment_type?: string;
  };
  add_shipping_info: {
    items?: Item[];
    currency?: string;
    value?: number;
    coupon?: string;
    shipping_tier?: string;
  };
  add_to_cart: {
    items?: Item[];
    currency?: string;
    value?: number;
  };
  add_to_wishlist: {
    items?: Item[];
    currency?: string;
    value?: number;
  };
  begin_checkout: {
    currency?: string;
    value?: number;
    coupon?: string;
    items?: Item[];
    [key: string]: any;
  };
  close_convert_lead: { currency: string; value: number };
  close_unconvert_lead: { currency: string; value: number; unconvert_lead_reason?: string };
  disqualify_lead: { currency: string; value: number; disqualified_lead_reason?: string };
  earn_virtual_currency: { virtual_currency_name: string; value: number };
  generate_lead: { currency?: string; value?: number };
  join_group: { group_id: string };
  level_end: { level: number; success?: string };
  level_start: { level: number };
  level_up: { level: number; character?: string };
  login: { method: string };
  post_score: { score: number; level?: number; character?: string };
  purchase: {
    affiliation?: string;
    coupon?: string;
    currency?: string;
    items?: Item[];
    shipping?: number;
    tax?: number;
    value?: number;
    transaction_id?: string;
    [key: string]: any;
  };
  qualify_lead: { currency: string; value: number };
  refund: {
    affiliation?: string;
    coupon?: string;
    currency?: string;
    items?: Item[];
    shipping?: number;
    tax?: number;
    value?: number;
    transaction_id?: string;
  };
  remove_from_cart: { items?: Item[]; value?: number; currency?: string };
  search: {
    search_term: string;
    number_of_nights?: number;
    number_of_rooms?: number;
    number_of_passengers?: number;
    origin?: string;
    destination?: string;
    start_date?: string;
    end_date?: string;
    travel_class?: string;
  };
  select_content: { content_type: string; item_id: string };
  select_item: {
    items?: Item[];
    content_type: string;
    item_list_id: string;
    item_list_name: string;
  };
  select_promotion: {
    creative_name: string;
    creative_slot: string;
    items?: Item[];
    location_id: string;
    promotion_id: string;
    promotion_name: string;
  };
  share: {
    content_type: string;
    item_id: string;
    method: string;
    activity_type?: string | null;
    post_id?: string;
  };
  sign_up: { method: string };
  spend_virtual_currency: { item_name: string; virtual_currency_name: string; value: number };
  tutorial_begin: undefined;
  tutorial_complete: undefined;
  unlock_achievement: { achievement_id: string };
  view_cart: { items?: Item[]; currency?: string; value?: number };
  view_item: { items?: Item[]; currency?: string; value?: number };
  view_item_list: { items?: Item[]; item_list_id?: string; item_list_name?: string };
  view_promotion: {
    items?: Item[];
    location_id?: string;
    creative_name?: string;
    creative_slot?: string;
    promotion_id?: string;
    promotion_name?: string;
  };
  working_lead: { currency: string; value: number; lead_status?: string };

  // Firebase Analytics events, event_name 40 characters limit, 25 parameters limit
  ad_impression: {
    value?: number;
    currency?: string;
    ad_format?: string;
    ad_platform?: string;
    ad_source?: string;
    ad_unit_name?: string;
  };
  app_open: undefined;
  campaign_details: {
    source: string;
    medium: string;
    campaign: string;
    term?: string;
    content?: string;
    aclid?: string;
    cp1?: string;
  };
  screen_view: { screen_name?: string; screen_class?: string };
  view_search_results: { search_term: string };
};

export type AllowedPropertyValues = string | number | boolean | null;
export type EventName = Lowercase<string>;
export type CustomEventProperties = Record<Lowercase<string>, AllowedPropertyValues>;

export type Properties<T extends EventName = EventName> = T extends keyof StandardEventProperties
  ? StandardEventProperties[T]
  : CustomEventProperties;

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

export type ThirdPartyLogger = <T extends EventName = EventName>(
  name: T,
  properties?: Properties<T>,
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
  device_pixel_ratio?: string;
  screen_resolution?: `${number}x${number}`;
}

export interface EnvironmentInfo {
  release?: string;
  language?: string;
  timezone?: string;
  environment?: 'development' | 'production';
}

export interface SourceInfo {
  source_url?: string;
  source?: 'app' | 'web' | 'offline';
}

export interface ThirdPartyFields {
  /**
   * Meta pixel fields
   * ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters#fbc
   * Stored in the _fbc/_fbp browser cookie under your domain
   */
  fbc?: string;
  fbp?: string;
}

export interface TrackTags
  extends PlatformInfo,
    DeviceInfo,
    EnvironmentInfo,
    SourceInfo,
    ThirdPartyFields {
  [key: string]: string | undefined;
}

export interface CreateTrackEventDTO<T extends EventName = EventName> {
  name: string;
  tags: TrackTags;
  properties?: Properties<T>;
  timestamp: number;
}

export interface TrackEventResponse {
  /**
   * track event id
   * some tracking system will use event_id and event_name for deduplication
   * */
  id: string;
}

export type VisitorProperties = Record<
  string,
  AllowedPropertyValues | AllowedPropertyValues[] | undefined
>;

export interface Visitor {
  id: string;
  device_id: string;
  timestamp: number;
  properties: VisitorProperties;
}

export interface CreateVisitorDTO {
  device_id: string;
  properties?: VisitorProperties;
}

export interface UpdateVisitorDTO {
  properties: VisitorProperties;
}
