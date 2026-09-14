import type { Item } from './gtag';
import type { EventName, TrackName, TrackProperties } from './types';

/**
 * Microsoft Advertising Universal Event Tracking (UET) — the `uetq` queue that `bat.js` drains.
 *
 * UET's modern event API is gtag-shaped: `uetq.push('event', '<action>', { ...params })`, and the
 * actions it knows (`purchase`, `add_to_cart`, `sign_up`, …) are GA4's recommended event names.
 * Since this SDK's own event names are GA4's too, a standard event maps onto UET under the same
 * name — only the parameter spellings differ (`value` → `revenue_value`, `Item` → `items[]`). An
 * unknown name goes out unchanged as a custom event, which is what a UET *event goal* matches on.
 *
 * Parameter names below are taken from `bat.js` itself (`knownParams`); the tag silently drops
 * any key it does not know, so an unmapped property is lost rather than an error. (bat.js's
 * `knownEvents` list is not an allow-list — the tag only uses it to inherit page-level `set`
 * parameters onto the events that carry them.)
 *
 * https://help.ads.microsoft.com/#apex/ads/en/56684/2 (custom events)
 * https://help.ads.microsoft.com/#apex/ads/en/56910/1 (retail / dynamic remarketing)
 * https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_uet_enhancedconversions
 */

/** The retail `ecomm_pagetype` values UET validates against. */
export type UETPageType =
  | 'home'
  | 'searchresults'
  | 'category'
  | 'product'
  | 'cart'
  | 'purchase'
  | 'other';

/** One entry of the `items` array (`items.*` in bat.js's `knownParams`). */
export interface UETItem {
  id?: string;
  name?: string;
  brand?: string;
  category?: string;
  variant?: string;
  price?: number;
  quantity?: number;
  list_name?: string;
  list_position?: number;
  location_id?: string;
}

/**
 * Enhanced conversions identifiers. Sent RAW: the tag normalizes and SHA-256 hashes them in the
 * browser before anything leaves the page (bat.js `validatePid`), and rejects a phone that is
 * not E.164 after stripping separators.
 */
export interface UETPid {
  em?: string;
  ph?: string;
}

/** The parameters of one `uetq.push('event', action, params)` call. */
export interface UETEventParams {
  /** Deduplicates against the same event sent through the Conversions API. */
  event_id?: string;
  event_category?: string;
  event_label?: string;
  event_value?: number;
  /** Variable revenue (`gv` on the wire). */
  revenue_value?: number;
  /** ISO 4217, uppercase (`gc` on the wire). */
  currency?: string;
  transaction_id?: string;
  tax?: number;
  shipping?: number;
  coupon?: string;
  items?: UETItem[];
  search_term?: string;
  method?: string;
  content_type?: string;
  content_id?: string;
  ecomm_prodid?: string | string[];
  ecomm_pagetype?: UETPageType;
  ecomm_totalvalue?: number;
  ecomm_category?: string;
  pid?: UETPid;
}

export type UETConsent = {
  ad_storage: 'granted' | 'denied';
  /**
   * `default` only: milliseconds to hold events for an `update` before acting on the default,
   * so a CMP that answers quickly does not cost the landing page. bat.js reads exactly this
   * lowercase key (some community snippets spell it `Wait_for_update`, which it ignores) and
   * caps it at 10,000.
   */
  wait_for_update?: number;
};

/**
 * `window.uetq` is a plain array until `bat.js` loads (the snippet does `w[u] = w[u] || []`), then
 * a `UET` instance that drains the queue; both expose `push`, which is all this SDK uses.
 */
export interface UETQ {
  push(command: 'event', action: string, params?: UETEventParams): void;
  push(command: 'pageLoad'): void;
  push(command: 'set', params: { pid?: UETPid }): void;
  push(command: 'consent', mode: 'default' | 'update', consent: UETConsent): void;
}

/** GA4 `Item` → UET `items[]` entry. Undefined fields are left for the caller to strip. */
export function mapItems(items?: Item[]): undefined | UETItem[] {
  if (!items || items.length === 0) return undefined;
  return items.map((item) => ({
    id: item.item_id,
    name: item.item_name,
    brand: item.item_brand,
    category: item.item_category,
    variant: item.item_variant,
    price: item.price,
    quantity: item.quantity,
    list_name: item.item_list_name,
    list_position: item.index,
    location_id: item.location_id,
  }));
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function currency(value: unknown): string | undefined {
  return string(value)?.toUpperCase();
}

const PAGE_TYPES: string[] = [
  'home',
  'searchresults',
  'category',
  'product',
  'cart',
  'purchase',
  'other',
];

function pageType(value: unknown): UETPageType | undefined {
  const lowered = string(value)?.toLowerCase();
  return lowered && PAGE_TYPES.includes(lowered) ? (lowered as UETPageType) : undefined;
}

/**
 * Map an internal track event onto a UET action and its parameters.
 *
 * The action is always the internal name: for the GA4-named standard events that is also the
 * name UET knows, and for everything else it is the custom action a UET event goal is configured
 * with. Keeping the name identical on both channels is what lets the Conversions API sender
 * (`eventName`) deduplicate against the browser (`event_id`).
 *
 * `page_view` is special to the tag: bat.js routes that action to its page-load beacon (the same
 * one the snippet fires on load and `enableAutoSpaTracking` fires on history changes), so the
 * browser tracker does not forward it — see `sendUETEvent`.
 */
export function mapUETEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
): [string, UETEventParams] {
  // A loose view of whatever the caller passed: every branch below reads only the keys it
  // knows and validates their types, so an event with foreign properties cannot leak them.
  const p = (properties ?? {}) as Record<string, unknown>;
  const params: UETEventParams = { event_id: eventId };

  // GA4's commerce parameters, spelled the UET way. `value` is GA4's revenue field and becomes
  // UET's variable revenue; every key here is one bat.js lists for the events that carry it.
  params.revenue_value = number(p.value) ?? number(p.revenue_value);
  params.currency = currency(p.currency);
  params.transaction_id = string(p.transaction_id);
  params.tax = number(p.tax);
  params.shipping = number(p.shipping);
  params.coupon = string(p.coupon);
  params.items = Array.isArray(p.items) ? mapItems(p.items as Item[]) : undefined;
  params.search_term = string(p.search_term);
  params.method = string(p.method);
  params.content_type = string(p.content_type);
  params.content_id = string(p.content_id);

  // The custom-event goal fields and the retail (dynamic remarketing) fields pass through under
  // their UET names, so a host can attach them to any event it defines.
  params.event_category = string(p.event_category);
  params.event_label = string(p.event_label);
  params.event_value = number(p.event_value);
  // bat.js throws on a `prodid` without a `pagetype` (`missingPageTypeException`), which would
  // cost the whole event; a product id on its own is dropped instead.
  params.ecomm_pagetype = pageType(p.ecomm_pagetype);
  params.ecomm_prodid = params.ecomm_pagetype
    ? Array.isArray(p.ecomm_prodid)
      ? (p.ecomm_prodid as string[])
      : string(p.ecomm_prodid)
    : undefined;
  params.ecomm_totalvalue = number(p.ecomm_totalvalue);
  params.ecomm_category = string(p.ecomm_category);

  return [name, params];
}
