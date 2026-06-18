import type { Item } from './gtag';
import type { EventName, TrackName, TrackProperties } from './types';

export const NON_AD_EVENTS = [
  // metrics
  'CLS',
  'FCP',
  'FID',
  'INP',
  'LCP',
  'TTFB',
  // promotions
  'view_promotion',
  'select_promotion',
];

/**
 * Content item shared by `contents` and `plan_enrollment` events.
 * https://developers.openai.com/ads/supported-events
 */
export type ContentItem = {
  id?: string;
  name?: string;
  content_type?: string;
  quantity?: number;
  /** Per-item monetary value in ISO 4217 minor units (e.g., 12,999 = $129.99 USD). */
  amount?: number;
  currency?: string;
};

export type ContentsData = {
  type: 'contents';
  /** Monetary value in ISO 4217 minor units (e.g., 12,999 = $129.99 USD). */
  amount?: number;
  currency?: string;
  contents?: ContentItem[];
};

export type CustomerActionData = {
  type: 'customer_action';
  amount?: number;
  currency?: string;
};

export type PlanEnrollmentData = {
  type: 'plan_enrollment';
  plan_id?: string;
  amount?: number;
  currency?: string;
  contents?: ContentItem[];
};

export type CustomEventData = {
  type: 'custom';
  amount?: number;
  currency?: string;
  contents?: ContentItem[];
};

export type EventData = ContentsData | CustomerActionData | PlanEnrollmentData | CustomEventData;

/**
 * Standard event names and the `data` shape each one expects.
 * https://developers.openai.com/ads/supported-events
 */
export type StandardEvents = {
  appointment_scheduled: CustomerActionData;
  checkout_started: ContentsData;
  contents_viewed: ContentsData;
  items_added: ContentsData;
  lead_created: CustomerActionData;
  order_created: ContentsData;
  page_viewed: ContentsData;
  registration_completed: CustomerActionData;
  subscription_created: PlanEnrollmentData;
  trial_started: PlanEnrollmentData;
};

export type StandardEvent = keyof StandardEvents;

/**
 * Identity fields passed to `oaiq("init", ...)` for conversion matching. Email and external id
 * must be pre-hashed as lowercase 64-char SHA-256 hex strings; the rest are sent as raw values.
 * https://developers.openai.com/ads/measurement-pixel
 */
export type OAIQUser = {
  email_sha256?: string;
  external_id_sha256?: string;
  /** Two-letter ISO 3166-1 country code (e.g. "US"). */
  country?: string;
  /** Lowercased, max 128 characters. */
  city?: string;
  /** Max 32 characters. */
  zip_code?: string;
};

export type InitConfig = {
  pixelId: string;
  /** Log SDK activity to the browser console. */
  debug?: boolean;
  user?: OAIQUser;
};

/**
 * Fourth argument of `oaiq("measure", ...)`. Required for custom events (carries
 * `custom_event_name`); optional for standard events.
 */
export type MeasureOptions = {
  /** Shared with the Conversions API to deduplicate the same conversion across browser and server. */
  event_id?: string;
  /** Required for custom events; 1-64 chars of letters, numbers, underscores, or dashes. */
  custom_event_name?: string;
  /** When true, opts the event out of user-level personalization. */
  opt_out?: boolean;
};

export interface OAIQ {
  oaiq(command: 'init', config: InitConfig): void;
  oaiq<T extends StandardEvent>(
    command: 'measure',
    event: T,
    data: StandardEvents[T],
    options?: MeasureOptions
  ): void;
  oaiq(
    command: 'measure',
    event: 'custom',
    data: CustomEventData,
    options: MeasureOptions & { custom_event_name: string }
  ): void;
}

/**
 * Currencies whose minor unit has 0 or 3 decimal places; everything else uses 2.
 * Follows Stripe's zero-decimal convention (e.g., MGA is treated as 0, ISK is included),
 * which can differ from strict ISO 4217 exponents.
 * https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Convert a major-unit amount (e.g., 129.99) into ISO 4217 minor units (e.g., 12,999). */
export function toMinorUnits(value?: number, currency?: string): number | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) return undefined;
  const code = currency?.toUpperCase();
  const exponent =
    code && ZERO_DECIMAL_CURRENCIES.has(code)
      ? 0
      : code && THREE_DECIMAL_CURRENCIES.has(code)
        ? 3
        : 2;
  return Math.round(value * 10 ** exponent);
}

export function mapContents(items?: Item[], currency?: string): ContentItem[] | undefined {
  if (!items || items.length === 0) return undefined;
  const code = currency?.toUpperCase();
  return items.map((item) => ({
    id: item.item_id,
    name: item.item_name,
    content_type: item.item_category,
    quantity: item.quantity,
    amount: toMinorUnits(item.price, currency),
    currency: item.price !== undefined ? code : undefined,
  }));
}

/** Safely read a property off loosely typed track properties without widening to `any`. */
function prop(properties: unknown, key: string): unknown {
  return typeof properties === 'object' && properties !== null
    ? (properties as Record<string, unknown>)[key]
    : undefined;
}

function readValue(properties: unknown): number | undefined {
  const value = prop(properties, 'value');
  return typeof value === 'number' ? value : undefined;
}

function readCurrency(properties: unknown): string | undefined {
  const currency = prop(properties, 'currency');
  return typeof currency === 'string' ? currency : undefined;
}

function readItems(properties: unknown): Item[] | undefined {
  const items = prop(properties, 'items');
  return Array.isArray(items) ? (items as Item[]) : undefined;
}

function contentsData(properties: unknown): ContentsData {
  const currency = readCurrency(properties);
  return {
    type: 'contents',
    amount: toMinorUnits(readValue(properties), currency),
    currency: currency?.toUpperCase(),
    contents: mapContents(readItems(properties), currency),
  };
}

function customerActionData(properties: unknown): CustomerActionData {
  const currency = readCurrency(properties);
  return {
    type: 'customer_action',
    amount: toMinorUnits(readValue(properties), currency),
    currency: currency?.toUpperCase(),
  };
}

function planEnrollmentData(properties: unknown): PlanEnrollmentData {
  const currency = readCurrency(properties);
  const items = readItems(properties);
  return {
    type: 'plan_enrollment',
    plan_id: items?.[0]?.item_id,
    amount: toMinorUnits(readValue(properties), currency),
    currency: currency?.toUpperCase(),
    contents: mapContents(items, currency),
  };
}

export type MappedOAIEvent = {
  type: StandardEvent | 'custom';
  data: EventData;
};

/** Map an internal track event onto an OpenAI standard (or custom) conversion event. */
export function mapOAIEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
): MappedOAIEvent {
  switch (name) {
    case 'page_view':
      return { type: 'page_viewed', data: contentsData(properties) };
    case 'view_item':
    case 'view_item_list':
      return { type: 'contents_viewed', data: contentsData(properties) };
    case 'begin_checkout':
      return { type: 'checkout_started', data: contentsData(properties) };
    case 'add_to_cart':
      return { type: 'items_added', data: contentsData(properties) };
    case 'purchase':
      return { type: 'order_created', data: contentsData(properties) };
    case 'generate_lead':
    case 'qualify_lead':
      return { type: 'lead_created', data: customerActionData(properties) };
    case 'sign_up':
    case 'login':
      return { type: 'registration_completed', data: customerActionData(properties) };
    case 'schedule':
      return { type: 'appointment_scheduled', data: customerActionData(properties) };
    case 'subscribe':
      return { type: 'subscription_created', data: planEnrollmentData(properties) };
    case 'trial_begin':
      return { type: 'trial_started', data: planEnrollmentData(properties) };
    default: {
      const currency = readCurrency(properties);
      return {
        type: 'custom',
        data: {
          type: 'custom',
          amount: toMinorUnits(readValue(properties), currency),
          currency: currency?.toUpperCase(),
          contents: mapContents(readItems(properties), currency),
        },
      };
    }
  }
}
