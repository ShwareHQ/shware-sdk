import type { EventName, TrackName, TrackProperties, Item } from './types';
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
  content_type?: 'product' | 'product_group' | (string & {});
  contents?: Content[];
  delivery_category?: 'in_store' | 'curbside' | 'home_delivery';
  currency?: string;
  num_items?: number;
  predicted_ltv?: number;
  search_string?: string;

  /** Used with the CompleteRegistration event, to show the status of the registration. */
  status?: boolean;
  value?: number;
};

/**
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/payload-helper
 */
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
    method?: string;
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

export type PixelId = `${number}`;

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
  /**
   * reference: https://stackoverflow.com/questions/62304291/sending-user-data-parameters-via-pixel
   *
   * Call init the normal default way first:
   * `fbq('init', 'XXXXX')`
   *
   * And at a later point in time, when you have obtained additional user data, you can call init
   * again basically enriching the already running fbq instance with additional data:
   * `fbq('init', 'XXXXX', { external_id: 1234, em: 'abc@abc.com' } )`
   *
   * Only caveat is that you have to send an event after this additional init call, otherwise the
   * provided data will not be sent to Facebook.
   */
  fbq(type: 'init', pixelId: PixelId, parameters?: MatchingParameters): void;

  /** Enable Manual Only mode. (value = false) */
  fbq(type: 'set', key: 'autoConfig', value: boolean, pixelId: PixelId): void;

  fbq<T extends keyof StandardEvents>(
    type: 'track',
    event: T,
    properties?: StandardEvents[T] & ObjectProperties,
    options?: { eventID?: string }
  ): void;

  fbq(
    type: 'trackCustom',
    event: string,
    properties?: Record<string, JSONValue> & ObjectProperties,
    options?: { eventID?: string }
  ): void;

  /** https://developers.facebook.com/docs/meta-pixel/guides/track-multiple-events/ */
  fbq<T extends keyof StandardEvents>(
    type: 'trackSingle',
    pixelId: PixelId,
    event: T,
    properties?: StandardEvents[T] & ObjectProperties,
    options?: { eventID?: string }
  ): void;

  /** https://developers.facebook.com/docs/meta-pixel/guides/track-multiple-events/ */
  fbq(
    type: 'trackSingleCustom',
    pixelId: PixelId,
    event: string,
    properties?: Record<string, JSONValue> & ObjectProperties,
    options?: { eventID?: string }
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
    country: parameters.country?.toLowerCase().replace(/[s/-]/g, '').trim(),
  };
}

function mapItems(items?: Item[]): ObjectProperties {
  if (!items) return {};
  const categories = Array.from(new Set(items.map((i) => i.item_category).filter(Boolean)));
  const contents = items.map(({ item_id, quantity, ...others }) => ({
    id: item_id!,
    quantity: quantity ?? 1,
    ...Object.fromEntries(
      Object.entries(others).map(([key, value]) => [key.replace('item_', ''), value])
    ),
  }));

  return {
    content_category: categories.length === 1 ? categories.at(0) : undefined,
    contents,
    content_ids: contents.map((c) => c.id),
    num_items: items.reduce((acc, i) => acc + (i.quantity ?? 1), 0),
  };
}

export function mapAndSendFbqEvent<T extends EventName>(
  fbq: Fbq['fbq'],
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  options?: { eventID?: string }
) {
  if (name === 'add_payment_info') {
    const p = properties as TrackProperties<'add_payment_info'> | undefined;
    fbq(
      'track',
      'AddPaymentInfo',
      { currency: p?.currency, value: p?.value, ...mapItems(p?.items) },
      options
    );
  } else if (name === 'add_to_cart') {
    const p = properties as TrackProperties<'add_to_cart'> | undefined;
    fbq(
      'track',
      'AddToCart',
      { currency: p?.currency, value: p?.value, ...mapItems(p?.items) },
      options
    );
  } else if (name === 'add_to_wishlist') {
    const p = properties as TrackProperties<'add_to_wishlist'> | undefined;
    fbq(
      'track',
      'AddToWishlist',
      { currency: p?.currency, value: p?.value, ...mapItems(p?.items) },
      options
    );
  } else if (name === 'login') {
    const p = properties as TrackProperties<'login'> | undefined;
    fbq('track', 'CompleteRegistration', { method: p?.method }, options);
  } else if (name === 'contact') {
    fbq('track', 'Contact', {}, options);
  } else if (name === 'customize_product') {
    fbq('track', 'CustomizeProduct', {}, options);
  } else if (name === 'donate') {
    fbq('track', 'Donate', {}, options);
  } else if (name === 'find_location') {
    fbq('track', 'FindLocation', {}, options);
  } else if (name === 'begin_checkout') {
    const p = properties as TrackProperties<'begin_checkout'> | undefined;
    fbq(
      'track',
      'InitiateCheckout',
      { currency: p?.currency, value: p?.value, ...mapItems(p?.items) },
      options
    );
  } else if (name === 'generate_lead') {
    const p = properties as TrackProperties<'generate_lead'> | undefined;
    fbq('track', 'Lead', { currency: p?.currency, value: p?.value }, options);
  } else if (name === 'purchase') {
    const p = properties as TrackProperties<'purchase'> | undefined;
    fbq(
      'track',
      'Purchase',
      p ? { currency: p?.currency, value: p?.value, ...mapItems(p?.items) } : undefined,
      options
    );
  } else if (name === 'schedule') {
    fbq('track', 'Schedule', {}, options);
  } else if (name === 'search') {
    const p = properties as TrackProperties<'search'> | undefined;
    fbq('track', 'Search', { search_string: p?.search_term }, options);
  } else if (name === 'trial_begin') {
    const p = properties as TrackProperties<'trial_begin'> | undefined;
    fbq('track', 'StartTrial', { currency: p?.currency, value: p?.value }, options);
  } else if (name === 'submit_application') {
    fbq('track', 'SubmitApplication', {}, options);
  } else if (name === 'subscribe') {
    const p = properties as TrackProperties<'subscribe'> | undefined;
    fbq('track', 'Subscribe', { currency: p?.currency, value: p?.value }, options);
  } else if (name === 'view_item') {
    const p = properties as TrackProperties<'view_item'> | undefined;
    fbq(
      'track',
      'ViewContent',
      { currency: p?.currency, value: p?.value, ...mapItems(p?.items) },
      options
    );
  } else {
    fbq('trackCustom', name, properties, options);
  }
}
