import type { Item } from './gtag';
import type { EventName, TrackName, TrackProperties } from './types';

/** https://business.reddithelp.com/s/article/about-event-metadata */
export type Product = {
  /**
   * (Required) Product ID: Either the SKU or GTIN, which represents the variant ID, not the
   * parent ID. If there are no variants, pass the assigned ID for that item.
   */
  id: string;

  /** (Optional) Product Category: The group the product belongs to. */
  name?: string;

  /** (Optional) Product Name: The title of the product. */
  category?: string;
};

/**
 * https://business.reddithelp.com/s/article/supported-conversion-events#supported-conversion-events
 * https://business.reddithelp.com/s/article/about-event-metadata
 * https://business.reddithelp.com/s/article/map-a-catalog-to-a-signal-source
 */
export type StandardEvents = {
  PageVisit: {
    conversionId?: string;
    products?: Product[];
  };
  ViewContent: {
    conversionId?: string;
    products?: Product[];
  };
  Search: {
    conversionId?: string;
    products?: Product[];
  };
  AddToCart: {
    value?: number;
    currency?: string;
    itemCount?: number;
    conversionId?: string;
    products?: Product[];
  };
  AddToWishlist: {
    value?: number;
    currency?: string;
    itemCount?: number;
    conversionId?: string;
    products?: Product[];
  };
  Purchase: {
    value?: number;
    currency?: string;
    itemCount?: number;
    conversionId?: string;
    products?: Product[];
  };
  Lead: {
    value?: number;
    currency?: string;
    conversionId?: string;
    products?: Product[];
  };
  SignUp: {
    value?: number;
    currency?: string;
    conversionId?: string;
    products?: Product[];
  };
};

export type PixelId = `a2_${string}`;

export type MatchKeys = {
  email?: string;
  phoneNumber?: string;
  externalId?: string;
  idfa?: string;
  aaid?: string;
};

export type CustomEventParams<T extends string = string> = {
  customEventName: T;
  value?: number;
  currency?: string;
  itemCount?: number;
  conversionId?: string;
  products?: Product[];
};

export interface RDT {
  rdt(event: 'init', pixelId: PixelId, matchKeys?: MatchKeys): void;

  rdt<T extends keyof StandardEvents>(event: 'track', type: T, params?: StandardEvents[T]): void;

  rdt(event: 'track', type: 'Custom', params: CustomEventParams): void;
}

type Mapped<F extends keyof StandardEvents> = [F, StandardEvents[F]];
type Missed<F extends string> = ['Custom', CustomEventParams<F>];

export function mapItems(items?: Item[]): undefined | Product[] {
  if (!items || items.length === 0) return undefined;
  return items.map((item) => ({
    id: item.item_id,
    name: item.item_name,
    category: item.item_category,
  }));
}

export function mapRDTEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
): Mapped<keyof StandardEvents> | Missed<TrackName<T>> {
  // standard events
  if (name === 'page_view') {
    return ['PageVisit', { conversionId: eventId }];
  } else if (name === 'view_item') {
    return ['ViewContent', { conversionId: eventId }];
  } else if (name === 'search') {
    return ['Search', { conversionId: eventId }];
  } else if (name === 'add_to_cart') {
    const p = properties as TrackProperties<'add_to_cart'> | undefined;
    return [
      'AddToCart',
      {
        conversionId: eventId,
        value: p?.value,
        currency: p?.currency.toUpperCase(),
        itemCount: p?.items?.reduce((acc, i) => acc + (i.quantity ?? 1), 0),
        products: mapItems(p?.items),
      },
    ];
  } else if (name === 'add_to_wishlist') {
    const p = properties as TrackProperties<'add_to_wishlist'> | undefined;
    return [
      'AddToWishlist',
      {
        conversionId: eventId,
        value: p?.value,
        currency: p?.currency.toUpperCase(),
        itemCount: p?.items?.reduce((acc, i) => acc + (i.quantity ?? 1), 0),
        products: mapItems(p?.items),
      },
    ];
  } else if (name === 'purchase') {
    const p = properties as TrackProperties<'purchase'> | undefined;
    return [
      'Purchase',
      {
        conversionId: eventId,
        value: p?.value,
        currency: p?.currency.toUpperCase(),
        itemCount: p?.items?.reduce((acc, i) => acc + (i.quantity ?? 1), 0),
        products: mapItems(p?.items),
      },
    ];
  } else if (name === 'generate_lead') {
    const p = properties as TrackProperties<'generate_lead'> | undefined;
    return [
      'Lead',
      { conversionId: eventId, value: p?.value, currency: p?.currency.toUpperCase() },
    ];
  } else if (name === 'sign_up' || name === 'login') {
    return ['SignUp', { conversionId: eventId }];
  } else {
    // custom event
    return [
      'Custom',
      {
        customEventName: name,
        conversionId: eventId,
        value:
          properties && 'value' in properties && typeof properties.value === 'number'
            ? properties.value
            : undefined,
        currency:
          properties && 'currency' in properties && typeof properties.currency === 'string'
            ? properties.currency.toUpperCase()
            : undefined,
      },
    ];
  }
}

export type ServerStandardEvent =
  | 'PAGE_VISIT'
  | 'VIEW_CONTENT'
  | 'SEARCH'
  | 'ADD_TO_CART'
  | 'ADD_TO_WISHLIST'
  | 'PURCHASE'
  | 'LEAD'
  | 'SIGN_UP';

export function mapServerStandardEvent(name: keyof StandardEvents): ServerStandardEvent {
  if (name === 'PageVisit') return 'PAGE_VISIT';
  if (name === 'ViewContent') return 'VIEW_CONTENT';
  if (name === 'Search') return 'SEARCH';
  if (name === 'AddToCart') return 'ADD_TO_CART';
  if (name === 'AddToWishlist') return 'ADD_TO_WISHLIST';
  if (name === 'Purchase') return 'PURCHASE';
  if (name === 'Lead') return 'LEAD';
  if (name === 'SignUp') return 'SIGN_UP';
  throw new Error(`Unsupported standard event: ${name}`);
}
