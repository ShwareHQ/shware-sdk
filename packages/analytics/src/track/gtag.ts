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
  user_property?: Record<string, string | boolean | number | null | undefined>;
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
    method?: string;
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
  };
  sign_up: {
    method?: string;
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
  screen_view: { screen_name?: string; screen_class?: string };
  view_search_results: { search_term: string };

  // Added events
  trial_begin: {
    currency: string;
    value: number;
  };

  subscribe: {
    currency: string;
    value: number;
  };
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
  gtag(
    event: 'set',
    option: 'user_property',
    properties: Record<string, string | boolean | number | null | undefined>
  ): void;

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
