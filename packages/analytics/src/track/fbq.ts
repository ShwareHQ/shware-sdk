export type Content = { id: string; quantity: number; [key: string]: unknown };

/**
 * reference: https://developers.facebook.com/docs/meta-pixel/advanced/advanced-matching
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
export type MatchingParameters = {
  /** Email: Unhashed lowercase or hashed SHA-256 */
  em?: string;

  /** First Name: Lowercase letters */
  fn?: string;

  /** Last Name: Lowercase letters */
  ln?: string;

  /** Phone Number: Digits only including country code and area code */
  ph?: string;

  /**
   * External ID: Any unique ID from the advertiser, such as loyalty membership ID, user ID, and
   * external cookie ID.
   */
  external_id?: string;

  /** Gender: Single lowercase letter, f or m, if unknown, leave blank */
  ge?: 'f' | 'm' | '';

  /** Birthdate: Digits only with birth year, month, then day, YYYYMMDD */
  db?: number;

  /** City: Lowercase with any spaces removed, e.g. "menlopark" */
  ct?: string;

  /** State or Province: Lowercase two-letter state or province code, e.g. "ca" */
  st?: string;

  /** Zip or Postal Code: String */
  zp?: string;

  /** Country: Lowercase two-letter country code, e.g. "us" */
  country?: string;

  /** Client IP Address: Do not hash. */
  client_ip_address?: string;

  /** Client User Agent: Do not hash. */
  client_user_agent?: string;

  /**
   * Click ID: Do not hash.
   * The Facebook click ID value is stored in the _fbc browser cookie under your domain. See
   * Managing fbc and fbp Parameters for how to get this value or generate this value from a fbclid
   * query parameter.
   *
   * The format is fb.${subdomain_index}.${creation_time}.${fbclid}.
   */
  fbc?: string;

  /**
   * Browser ID: Do not hash.
   * The Facebook browser ID value is stored in the _fbp browser cookie under your domain. See
   * Managing fbc and fbp Parameters for how to get this value.
   *
   * The format is fb.${subdomain_index}.${creation_time}.${random_number}.
   */
  fbp?: string;

  /**
   * Subscription ID: Do not hash.
   * The subscription ID for the user in this transaction; it is similar to the order ID for an
   * individual product.
   */
  subscription_id?: string;

  /**
   * Facebook Login ID: Do not hash.
   * The ID issued by Meta when a person first logs into an instance of an app. This is also known
   * as App-Scoped ID.
   */
  fb_login_id?: number;

  /**
   * Lead ID: Do not hash.
   * The ID associated with a lead generated by [Meta's Lead Ads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads).
   */
  lead_id?: number;

  /**
   * Install ID: Do not hash.
   * Your install ID. This field represents unique application installation instances.
   * Note: This parameter is for app events only.
   */
  anon_id?: string;

  /**
   * Your mobile advertiser ID, the advertising ID from an Android device or the Advertising
   * Identifier (IDFA) from an Apple device.
   */
  madid?: string;

  /**
   * Page ID: Do not hash.
   * Your Page ID. Specifies the page ID associated with the event. Use the Facebook page ID of the
   * page associated with the bot.
   */
  page_id?: string;

  /**
   * Page Scoped User ID: Do not hash.
   * Specifies the page-scoped user ID associated with the messenger bot that logs the event. Use
   * the page-scoped user ID provided to your webhook.
   */
  page_scoped_user_id?: string;

  /**
   * Do not hash.
   * Click ID generated by Meta for ads that click to WhatsApp.
   */
  ctwa_clid?: string;

  /**
   * Do not hash.
   * Instagram Account ID that is associated with the business.
   */
  ig_account_id?: string;

  /**
   * Do not hash.
   * Users who interact with Instagram are identified by Instagram-Scoped User IDs (IGSID). IGSID
   * can be obtained from this webhook.
   */
  ig_sid?: string;
};

/**
 * You can include the following predefined object properties with any custom events, and any
 * standard events that support them. Format your parameter object data using JSON. Learn more about
 * event parameters with Blueprint.
 */
export type ObjectProperties = {
  content_category?: string;
  content_ids?: string[];
  content_name?: string;

  /**
   * Either product or product_group based on the content_ids or contents being passed. If the IDs
   * being passed in content_ids or contents parameter are IDs of products, then the value should be
   * product. If product group IDs are being passed, then the value should be product_group.
   *
   * If no content_type is provided, Meta will match the event to every item that has the same ID,
   * independent of its type.
   */
  content_type?: string;
  contents?: Content[];
  currency?: string;
  num_items?: number;
  predicted_ltv?: number;
  search_string?: string;

  /** Used with the CompleteRegistration event, to show the status of the registration. */
  status?: boolean;
  value?: number;
};

export type StandardEvents = {
  AddPaymentInfo: {
    content_ids?: string[];
    contents?: Content[];
    currency?: string;
    value?: number;
  };
  AddToCart: {
    content_ids?: string[];
    content_type?: string;
    contents?: Content[]; // Required for Advantage+ catalog ads: contents
    currency?: string;
    value?: number;
  };
  AddToWishlist: {
    content_ids?: string[];
    contents?: Content[];
    currency?: string;
    value?: number;
  };
  CompleteRegistration: {
    currency?: string;
    value?: number;
  };
  Contact: {};
  CustomizeProduct: {};
  Donate: {};
  FindLocation: {};
  InitiateCheckout: {
    content_ids?: string[];
    contents?: Content[];
    currency?: string;
    num_items?: number;
    value?: number;
  };
  Lead: {
    currency?: string;
    value?: number;
  };
  Purchase: {
    content_ids?: string[]; // Required for Advantage+ catalog ads: contents or content_ids
    content_type?: string;
    contents?: Content[]; // Required for Advantage+ catalog ads: contents or content_ids
    currency: string; // required
    num_items?: number;
    value: number; // required
  };
  Schedule: {};
  Search: {
    content_ids?: string[]; // Required for Advantage+ catalog ads: contents or content_ids
    content_type?: string;
    contents?: Content[]; // Required for Advantage+ catalog ads: contents or content_ids
    currency?: string;
    search_string?: string;
    value?: number;
  };
  StartTrial: {
    currency?: string;
    predicted_ltv?: number;
    value?: number;
  };
  SubmitApplication: {};
  Subscribe: {
    currency?: string;
    predicted_ltv?: number;
    value?: number;
  };
  ViewContent: {
    content_ids?: string[]; // Required for Advantage+ catalog ads: contents or content_ids
    content_type?: string;
    contents?: Content[]; // Required for Advantage+ catalog ads: contents or content_ids
    currency?: string;
    value?: number;
  };
};

type JSONValue =
  | null
  | string
  | number
  | boolean
  | Array<JSONValue>
  | { [value: string]: JSONValue };

/**
 * reference: https://developers.facebook.com/docs/meta-pixel/reference#standard-events
 *
 * We determine if events are identical based on their ID and name. So, for an event to be deduplicated:
 * - In corresponding events, a Meta Pixel's eventID must match the Conversion API's event_id.
 * - In corresponding events, a Meta Pixel's event must match the Conversion API's event_name.
 *
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
export interface Fbq {
  fbq(type: 'init', pixelId: `${number}`, parameters?: MatchingParameters): void;

  /** Enable Manual Only mode. (value = false) */
  fbq(type: 'set', key: 'autoConfig', value: boolean, pixelId: `${number}`): void;

  fbq<T extends keyof StandardEvents>(
    type: 'track',
    event: T,
    properties?: StandardEvents[T] & ObjectProperties,
    options?: { eventID: string }
  ): void;

  fbq(
    type: 'trackCustom',
    event: string,
    properties?: Record<string, JSONValue> & ObjectProperties,
    options?: { eventID: string }
  ): void;

  /** https://developers.facebook.com/docs/meta-pixel/guides/track-multiple-events/ */
  fbq<T extends keyof StandardEvents>(
    type: 'trackSingle',
    pixelId: `${number}`,
    event: T,
    properties?: StandardEvents[T] & ObjectProperties,
    options?: { eventID: string }
  ): void;

  /** https://developers.facebook.com/docs/meta-pixel/guides/track-multiple-events/ */
  fbq(
    type: 'trackSingleCustom',
    pixelId: `${number}`,
    event: string,
    properties?: Record<string, JSONValue> & ObjectProperties,
    options?: { eventID: string }
  ): void;
}

/**
 * Please download this CSV filefor examples of properly normalized and hashed data for the
 * parameters below.
 */
export function normalize(parameters: MatchingParameters): MatchingParameters {
  return {
    ...parameters,
    em: parameters.em?.toLowerCase().trim(),
    ph: parameters.ph?.replace(/[\+\-\(\)\s]/g, '').replace(/^0+/, ''),
    zp: parameters.zp?.split('-').at(0)?.trim(),
    fn: parameters.fn?.toLowerCase().trim(),
    ln: parameters.ln?.toLowerCase().trim(),
    ct: parameters.ct?.toLowerCase().replace(/[s/-]/g, '').trim(),
    st: parameters.st
      ?.toLowerCase()
      .replace(/[s/-/,.]/g, '')
      .trim(),
    country: parameters.country?.replace(/[s/-]/g, '').trim(),
  };
}
