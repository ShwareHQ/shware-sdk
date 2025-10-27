/** reference: https://support.google.com/analytics/answer/13316687 */
const reservedWebEventNames = [
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_renew',
  'click',
  'error',
  'file_download',
  'first_open',
  'first_visit',
  'form_start',
  'form_submit',
  'in_app_purchase',
  'page_view',
  'scroll',
  'session_start',
  'user_engagement',
  'view_complete',
  'video_progress',
  'video_start',
  'view_search_results',
] as const;

const reservedAppEventNames = [
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'ad_impression',
  'ad_query',
  'ad_reward',
  'adunit_exposure',
  'app_clear_data',
  'app_exception',
  'app_install',
  'app_remove',
  'app_store_refund',
  'app_update',
  'app_upgrade',
  'dynamic_link_app_open',
  'dynamic_link_app_update',
  'dynamic_link_first_open',
  'error',
  'firebase_campaign',
  'firebase_in_app_message_action',
  'firebase_in_app_message_dismiss',
  'firebase_in_app_message_impression',
  'first_open',
  'first_visit',
  'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'notification_send',
  'os_update',
  'screen_view',
  'session_start',
  'user_engagement',
] as const;

export const reservedEventNames = [...reservedWebEventNames, ...reservedAppEventNames] as const;

type ReservedWebEventNames = (typeof reservedWebEventNames)[number];
type ReservedAppEventNames = (typeof reservedAppEventNames)[number];
export type ReservedEventNames = ReservedWebEventNames | ReservedAppEventNames;

export type ReservedEventValues =
  | 'cid'
  | 'currency'
  | 'customer_id'
  | 'customerid'
  | 'dclid'
  | 'gclid'
  | 'session_id'
  | 'sessionid'
  | 'sfmc_id'
  | 'sid'
  | 'srsltid'
  | 'uid'
  | 'user_id'
  | 'userid'
  | `_${string}`
  | `firebase_${string}`
  | `ga_${string}`
  | `google_${string}`
  | `gtag.${string}`;

export type ReservedUserPropertiesNames =
  | 'cid'
  | 'customer_id'
  | 'customerid'
  | 'first_open_after_install'
  | 'first_open_time'
  | 'first_visit_time'
  | 'google_allow_ad_personalization_signals'
  | 'last_advertising_id_reset'
  | 'last_deep_link_referrer'
  | 'last_gclid'
  | 'lifetime_user_engagement'
  | 'non_personalized_ads'
  | 'session_id'
  | 'session_number'
  | 'sessionid'
  | 'sfmc_id'
  | 'sid'
  | 'uid'
  | 'user_id'
  | 'userid'
  | `_${string}`
  | `firebase_${string}`
  | `ga_${string}`
  | `google_${string}`;

export type UserPropertiesValue = string | boolean | number | null | undefined;
export type UserProperties = {
  [key: string]: UserPropertiesValue;
} & {
  [key in ReservedUserPropertiesNames]?: never;
};

/**
 * reference: https://support.google.com/analytics/answer/14078702
 * You must turn on user-provided data collection in Google Analytics.
 *
 * Validate your user-provided data implementation: https://support.google.com/analytics/answer/14171683
 *
 * Usage: gtag('set', 'user_data', { email: 'abc@abc.com' })
 *
 * In order to standardize the hash results, prior to hashing one of these values you must:
 *
 * - Remove leading and trailing whitespaces.
 * - Convert the text to lowercase.
 * - Format phone numbers according to the E164 standard.
 * - Remove all periods (.) that precede the domain name in gmail.com and googlemail.com email addresses.
 * */
type UserProvidedDataAddress = {
  first_name?: string;
  last_name?: string;
  street?: string;
  city?: string;
  /** User province, state, or region. Example: `Hampshire` */
  region?: string;
  postal_code?: string;
  /**
   * User country code.
   * Example: 'UK'. Use 2-letter country codes, per the ISO 3166-1 alpha-2 standard.
   */
  country?: string;
};

/**
 * In order to standardize the hash results, prior to hashing one of these values you must:
 *
 * - Remove leading and trailing whitespaces.
 * - Convert the text to lowercase.
 * - Format phone numbers according to the E164 standard.
 * - Remove all periods (.) that precede the domain name in gmail.com and googlemail.com email addresses.
 */
export type UserProvidedData = {
  email?: string | string[];
  /**
   * User phone number. Must be in E.164 format, which means it must be 11 to 15 digits including a
   * plus sign (+) prefix and country code with no dashes, parentheses, or spaces.
   *
   * Example: ‘+11231234567’
   */
  phone_number?: string | string[];
  address?: UserProvidedDataAddress | UserProvidedDataAddress[];
};

export type GaId = `G-${Uppercase<string>}`;
export type GtmId = `GTM-${Uppercase<string>}`;

export type CampaignMedium =
  | 'email'
  | 'organic'
  | 'cpc'
  | 'banner'
  | 'social'
  | 'referral'
  | 'affiliate'
  | 'video'
  | 'display'
  | 'sms'
  | 'push'
  | 'qr'
  | 'audio'
  | (string & {});

export type CampaignSource =
  | 'google' // don't need to set
  | 'googleads'
  | 'bing'
  | 'bingads'
  | 'metaads'
  | 'facebook'
  | 'twitter'
  | 'linkedin'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'newsletter'
  | `website_${string}`
  | `affiliate_${string}`
  | (string & {});

export type Campaign = {
  id?: string;
  name?: string;
  term?: string;
  content?: string;
  medium?: CampaignMedium;
  source?: CampaignSource;
};

export type Config = {
  allow_google_signals?: boolean;
  allow_ad_personalization_signals?: boolean;

  campaign_content?: string;
  campaign_id?: string;
  campaign_medium?: CampaignMedium;
  campaign_name?: string;
  campaign_source?: CampaignSource;
  campaign_term?: string;

  /**
   * @deprecated
   * Key Point: Use the campaign_ prefixed version of each campaign value instead of this field.
   */
  campaign?: Campaign;

  client_id?: string;
  content_group?: string;

  cookie_domain?: 'none' | 'auto' | string;
  cookie_expires?: number;
  cookie_flags?: string;
  cookie_path?: string;
  cookie_prefix?: string;
  cookie_update?: boolean;

  ignore_referrer?: boolean;
  language?: string;

  page_location?: string;
  page_referrer?: string;
  page_title?: string;

  send_page_view?: boolean;
  screen_resolution?: `${number}x${number}`;
  user_id?: string;
  user_properties?: UserProperties;
};

export type Item = {
  item_id: string;
  item_name: string;
  affiliation?: 'Google Store' | (string & {});
  coupon?: string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  quantity?: number;
};

export type PromotionItem = {
  creative_name?: string;
  creative_slot?: string;
  promotion_id?: string;
  promotion_name?: string;
};

export type SurveyProperties = {
  id?: string;
  feature?: Lowercase<string>;
  trigger?: Lowercase<string>;
};

export type SurveyQA = {
  q1: string;
  a1: string;
  q2?: string;
  a2?: string;
  q3?: string;
  a3?: string;
  q4?: string;
  a4?: string;
  q5?: string;
  a5?: string;
  q6?: string;
  a6?: string;
  completed?: boolean;
};

export type NPSScore = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | number;
export type CASTScore = 1 | 2 | 3 | 4 | 5 | number;
export type CESScore = 1 | 2 | 3 | 4 | 5 | number;

/**
 * ref: https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag
 * ref: https://firebase.google.com/docs/reference/android/com/google/firebase/analytics/FirebaseAnalytics.Event
 * */
export type StandardEvents = {
  // Google Analytics 4 Recommended Events
  add_payment_info: {
    currency: string;
    value: number;
    coupon?: string;
    payment_type?: string;
    items: Item[];
  };
  add_shipping_info: {
    currency: string;
    value: number;
    coupon?: string;
    shipping_tier?: string;
    items: Item[];
  };
  add_to_cart: {
    currency: string;
    value: number;
    items: Item[];
  };
  add_to_wishlist: {
    currency: string;
    value: number;
    items: Item[];
  };
  begin_checkout: {
    currency: string;
    value: number;
    coupon?: string;
    items: Item[];
    source?: string; // added
  };
  close_convert_lead: {
    currency: string;
    value: number;
  };
  close_unconvert_lead: {
    currency: string;
    value: number;
    unconvert_lead_reason?: string;
  };
  disqualify_lead: {
    currency: string;
    value: number;
    disqualified_lead_reason?: string;
  };
  earn_virtual_currency: {
    virtual_currency_name?: string;
    value?: number;
  };
  generate_lead: {
    currency: string;
    value: number;
    lead_source?: string;
  };
  join_group: {
    group_id?: string;
  };
  level_end: {
    level_name?: string;
    success?: boolean;
  };
  level_start: {
    level_name?: string;
  };
  level_up: {
    level?: number;
    level_name?: string;
    character?: string;
  };
  login: {
    method?:
      | 'google'
      | 'apple'
      | 'facebook'
      | 'twitter'
      | 'linkedin'
      | 'github'
      | 'microsoft'
      | 'wechat'
      | 'onetap'
      | 'phone'
      | 'email'
      | (string & {});
    source?: string; // added
  };
  post_score: {
    score: number;
    level?: number;
    character?: string;
  };
  purchase: {
    currency: string;
    value: number;
    transaction_id: string;
    coupon?: string;
    shipping?: number; // Shipping cost associated with a transaction.
    tax?: number;
    items?: Item[];
    source?: string; // added
  };
  qualify_lead: {
    currency: string;
    value: number;
  };
  refund: {
    currency: string;
    value: number;
    transaction_id: string;
    coupon?: string;
    shipping?: number;
    tax?: number;
    items?: Item[];
  };
  remove_from_cart: {
    currency: string;
    value: number;
    items: Item[];
  };
  search: {
    search_term: string;
  };
  select_content: {
    content_type?: string;
    content_id?: string;
  };
  select_item: {
    item_list_id?: string;
    item_list_name?: string;
    items: Item[];
  };
  select_promotion: {
    creative_name?: string;
    creative_slot?: string;
    promotion_id?: string;
    promotion_name?: string;
    items?: (Item & PromotionItem)[];
  };
  share: {
    method?: string;
    content_type?: string;
    item_id?: string;
    system_activity_type?: string; // added
    platform_post_id?: string; // added
  };
  sign_up: {
    method?: string;
    source?: string; // added
  };
  spend_virtual_currency: {
    value: number;
    virtual_currency_name: string;
    item_name?: string;
  };
  tutorial_begin: undefined;
  tutorial_complete: undefined;
  unlock_achievement: {
    achievement_id: string;
  };
  view_cart: {
    currency: string;
    value: number;
    items: Item[];
  };
  view_item: {
    currency: string;
    value: number;
    items: Item[];
  };
  view_item_list: {
    currency: string;
    item_list_id?: string;
    item_list_name?: string;
    items: Item[];
  };
  view_promotion: {
    creative_name?: string;
    creative_slot?: string;
    promotion_id?: string;
    promotion_name?: string;
    items: (Item & PromotionItem)[];
  };
  working_lead: {
    currency: string;
    value: number;
    lead_status?: string;
  };

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
  screen_view: {
    screen_name?: string;
    screen_class?: string;
    previous_screen_class?: string; // added
    previous_screen_class_duration?: number; // added, in seconds
  };
  view_search_results: { search_term: string };

  // Added events
  page_view: {
    page_path: string;
    page_title: string;
    page_referrer?: string;
    page_location?: string;
    previous_pathname?: string;
    previous_pathname_duration?: number;
  };
  trial_begin: {
    currency: string;
    value: number;
    source?: string; // added
  };
  subscribe: {
    currency: string;
    value: number;
    source?: string; // added
  };
  // survey
  survey_shown: SurveyProperties;
  survey_sent: SurveyProperties & SurveyQA;
  survey_dismissed: SurveyProperties;
  /**
   * Net promoter score: Get an industry-recognized benchmark
   * How likely are you to recommend us to a friend?
   * */
  nps_shown: SurveyProperties;
  nps_sent: SurveyProperties & { score: NPSScore; feedback?: string };
  nps_dismissed: SurveyProperties;
  /**
   * Customer satisfaction score: Works best after a checkout or support flow
   * How satisfied are you with xxx?
   * */
  cast_shown: SurveyProperties;
  cast_sent: SurveyProperties & { score: CASTScore; feedback?: string };
  cast_dismissed: SurveyProperties;
  /**
   * Customer effort score: Works well with churn surveys
   * How easy is it to use the feature?
   * */
  ces_shown: SurveyProperties;
  ces_sent: SurveyProperties & { score: CESScore; feedback?: string };
  ces_dismissed: SurveyProperties;
};

/**
 * reference: https://developers.google.com/analytics/devguides/collection/ga4/reference/config
 * reference: https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag
 */
export interface Gtag {
  /**
   * To disable advertising features based on third-party advertising identifiers, set
   * allow_google_signals to false.
   *
   * @param allow - Whether to allow Google signals.
   * @default true
   */
  gtag(event: 'set', option: 'allow_google_signals', allow: boolean): void;

  /**
   * Set to false to disable advertising personalization features.
   *
   * @param allow - Whether to allow ad personalization signals.
   * @default true
   */
  gtag(event: 'set', option: 'allow_ad_personalization_signals', allow: boolean): void;

  /**
   * Used for A/B testing and content-targeted ads. Use campaign_content to differentiate ads or
   * links that point to the same URL.
   */
  gtag(event: 'set', option: 'campaign_content', content: string): void;

  /**
   * Used to identify which campaign this referral references. Use campaign_id to identify a
   * specific campaign.
   */
  gtag(event: 'set', option: 'campaign_id', id: string): void;

  /** Use campaign_medium to identify a medium such as email or cost-per-click. */
  gtag(event: 'set', option: 'campaign_medium', medium: CampaignMedium): void;

  /**
   * Used for keyword analysis. Use campaign_name to identify a specific product promotion or
   * strategic campaign.
   */
  gtag(event: 'set', option: 'campaign_name', name: string): void;

  /** Use campaign_source to identify a search engine, newsletter name, or other source. */
  gtag(event: 'set', option: 'campaign_source', source: CampaignSource): void;

  /** Used for paid search. Use campaign_term to note the keywords for this ad. */
  gtag(event: 'set', option: 'campaign_term', term: string): void;

  /**
   * @deprecated
   * Key Point: Use the campaign_ prefixed version of each campaign value instead of this field.
   */
  gtag(event: 'set', option: 'campaign', params: Campaign): void;

  /**
   * Pseudonymously identifies a browser instance. By default, this value is stored as part of the
   * first-party Analytics cookie with a two-year expiration.
   */
  gtag(event: 'set', option: 'client_id', id: string): void;

  /** example: gtag('set', 'content_group', '/news/sports'); */
  gtag(event: 'set', option: 'content_group', group: string): void;

  /**
   * Specifies the domain used to store the analytics cookie.
   * Set to 'none' to set the cookie without specifying a domain.
   * Set to 'auto' (the default value) to set the cookie to the top level domain plus one
   * subdomain (eTLD +1). For example if cookie_domain is set to 'auto' https://example.com would
   * use example.com for the domain, and https://subdomain.example.com would also use example.com
   * for the domain.
   *
   * @param domain - The domain used to store the analytics cookie.
   * @default 'auto'
   */
  gtag(event: 'set', option: 'cookie_domain', domain: 'none' | 'auto' | string): void;

  /**
   * Every time a hit is sent to Google Analytics, the cookie expiration time is updated to be the
   * current time plus the value of the cookie_expires field. This means that if you use the default
   * value time of two years (63072000 seconds), and a user visits your site every month, their
   * cookie will never expire.
   *
   * If you set the cookie_expires time to 0 (zero) seconds, the cookie turns into a session based
   * cookie and expires once the current browser session ends.
   *
   * Caution: If you set the cookie to expire too quickly, you will inflate your user count and
   * decrease the quality of your measurement.
   *
   * @param expires - The number of seconds until the cookie expires.
   * @default 63072000
   */
  gtag(event: 'set', option: 'cookie_expires', expires: number): void;

  /**
   * Appends additional flags to the cookie when set. Flags must be separated by semicolons. See
   * [write a new cookie](https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie#write_a_new_cookie) for some examples of flags to set.
   */
  gtag(event: 'set', option: 'cookie_flags', flags: string): void;

  /** Specifies the subpath used to store the analytics cookie. */
  gtag(event: 'set', option: 'cookie_path', path: string): void;

  /** Specifies a prefix to prepend to analytics cookie names. */
  gtag(event: 'set', option: 'cookie_prefix', prefix: string): void;

  /**
   * When cookie_update is set to true, gtag.js will update cookies on each page load. This will
   * update the cookie expiration to be set relative to the most recent visit to the site. For
   * example, if cookie expiration is set to one week, and a user visits using the same browser
   * every five days, the cookie expiration will be updated on each visit and will effectively
   * never expire.
   *
   * When set to false, cookies are not updated on each page load. This has the effect of cookie
   * expiration being relative to the first time a user visited the site.
   *
   * @param update - Whether to update the cookie on each page load.
   * @default true
   */
  gtag(event: 'set', option: 'cookie_update', update: boolean): void;

  /**
   * Set to true to indicate to Analytics that the referrer shouldn't be displayed as a traffic
   * source. [Learn when to use this field](https://support.google.com/analytics/answer/10327750#set-parameter)
   *
   * @param ignore - Whether to ignore the referrer.
   * @default false
   */
  gtag(event: 'set', option: 'ignore_referrer', ignore: boolean): void;

  /**
   * Specifies the language preference of the user. Defaults to the user's navigator.language value.
   *
   * @param language - The language preference of the user.
   * @default navigator.language
   */
  gtag(event: 'set', option: 'language', language: string): void;

  /**
   * Specifies the full URL of the page. Defaults to the user's document.location value.
   *
   * @param location - The full URL of the page. Character limit 1000
   * @default document.location
   */
  gtag(event: 'set', option: 'page_location', location: string): void;

  /**
   * Specifies which referral source brought traffic to a page. This value is also used to compute
   * the traffic source. The format of this value is a URL. Defaults to the user's document.referrer
   * value.
   *
   * @param referrer - The referral source. Character limit 420
   * @default document.referrer
   */
  gtag(event: 'set', option: 'page_referrer', referrer: string): void;

  /**
   * The title of the page or document. Defaults to the user's document.title value.
   *
   * @param title - The title of the page or document. Character limit 300
   * @default document.title
   */
  gtag(event: 'set', option: 'page_title', title: string): void;

  /**
   * Set to false to prevent the default snippet from sending a page_view.
   *
   * @param send - Whether to send a page_view.
   * @default true
   */
  gtag(event: 'set', option: 'send_page_view', send: boolean): void;

  /**
   * Specifies the resolution of the screen. Should be two positive integers separated by an x. For
   * example, for an 800px by 600px screen, the value would be 800x600. Calculated from the user's
   * window.screen value.
   *
   * @param resolution - The resolution of the screen.
   * @default window.screen
   */
  gtag(event: 'set', option: 'screen_resolution', resolution: `${number}x${number}`): void;

  /**
   * Specifies a known identifier for a user provided by the site owner/library user. It must not
   * itself be PII (personally identifiable information). The value should never be persisted in
   * Google Analytics cookies or other Analytics provided storage.
   *
   * @param userId - The user ID. Character limit 256
   */
  gtag(event: 'set', option: 'user_id', userId: string): void;

  /**
   * User properties are attributes that can be used to describe segments of your user base, such
   * as language preference or geographic location. Up to 25 additional user properties can be set
   * per project.
   *
   * @param name - The name of the user property. Character limit 24
   * @param value - The value of the user property. Character limit 36
   */
  gtag(event: 'set', option: 'user_properties', properties: UserProperties): void;

  gtag(event: 'set', option: 'user_data', data: UserProvidedData): void;

  /**
   * gtag('config', ...) Set for a single stream
   * gtag('set', ...) Set globally
   */
  gtag(event: 'config', gaId: GaId, config?: Config): void;

  gtag<T extends string>(
    event: 'event',
    eventName: T extends keyof StandardEvents ? T : string,
    eventParams?: T extends keyof StandardEvents
      ? StandardEvents[T]
      : Record<string, string | number | boolean | null | undefined>
  ): void;
}
