import { describe, expect, it } from 'vitest';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { mapFBEvent, mapItems as mapFBItems, normalize } from './fbq';
import { NON_AD_EVENTS, mapContents, mapOAIEvent, toMinorUnits } from './oaiq';
import { mapRDTEvent, mapServerStandardEvent } from './rdt';

const purchase = {
  value: 99.5,
  currency: 'usd',
  transaction_id: 'txn-1',
  items: [
    { item_id: 'sku-1', item_name: 'One', price: 49.5, quantity: 1 },
    { item_id: 'sku-2', item_name: 'Two', price: 25, quantity: 2 },
  ],
};

describe('mapFBEvent', () => {
  it('maps purchase onto the standard Meta event', () => {
    const [type, name, props] = mapFBEvent('purchase', purchase);
    expect(type).toBe('track');
    expect(name).toBe('Purchase');
    expect(props).toMatchObject({ currency: 'usd', value: 99.5 });
  });

  it('falls back to trackCustom with the original name and properties', () => {
    const [type, name, props] = mapFBEvent('started_trial_from_banner', { plan: 'pro' });
    expect(type).toBe('trackCustom');
    expect(name).toBe('started_trial_from_banner');
    expect(props).toEqual({ plan: 'pro' });
  });

  it.each([
    ['add_payment_info', 'AddPaymentInfo'],
    ['add_to_cart', 'AddToCart'],
    ['add_to_wishlist', 'AddToWishlist'],
    ['login', 'CompleteRegistration'],
    ['contact', 'Contact'],
    ['customize_product', 'CustomizeProduct'],
    ['donate', 'Donate'],
    ['find_location', 'FindLocation'],
    ['begin_checkout', 'InitiateCheckout'],
    ['generate_lead', 'Lead'],
    ['schedule', 'Schedule'],
    ['search', 'Search'],
    ['trial_begin', 'StartTrial'],
    ['submit_application', 'SubmitApplication'],
    ['subscribe', 'Subscribe'],
    ['view_item', 'ViewContent'],
  ] as const)('maps %s onto the standard %s event', (internal, standard) => {
    const [type, name] = mapFBEvent(internal, undefined);
    expect(type).toBe('track');
    expect(name).toBe(standard);
  });

  it('search carries the search term as search_string', () => {
    const [, , props] = mapFBEvent('search', { search_term: 'shoes' });
    expect(props).toEqual({ search_string: 'shoes' });
  });

  it('purchase without properties still satisfies Meta required fields', () => {
    const [, , props] = mapFBEvent('purchase', undefined);
    expect(props).toMatchObject({ currency: 'USD', value: 0 });
  });

  it('mapItems builds contents, content_ids and num_items from GA items', () => {
    const props = mapFBItems(purchase.items);
    expect(props.contents).toEqual([
      {
        id: 'sku-1',
        quantity: 1,
        item_price: 49.5,
        title: 'One',
        brand: undefined,
        category: undefined,
      },
      {
        id: 'sku-2',
        quantity: 2,
        item_price: 25,
        title: 'Two',
        brand: undefined,
        category: undefined,
      },
    ]);
    expect(props.content_ids).toEqual(['sku-1', 'sku-2']);
    expect(props.num_items).toBe(3);
  });

  it('mapItems reports content_category only when every item agrees on one', () => {
    const same = [
      { item_id: 'a', item_name: 'A', item_category: 'plans' },
      { item_id: 'b', item_name: 'B', item_category: 'plans' },
    ];
    const mixed = [
      { item_id: 'a', item_name: 'A', item_category: 'plans' },
      { item_id: 'b', item_name: 'B', item_category: 'addons' },
    ];
    expect(mapFBItems(same).content_category).toBe('plans');
    expect(mapFBItems(mixed).content_category).toBeUndefined();
    expect(mapFBItems(undefined)).toEqual({});
  });
});

describe('normalize (Meta advanced matching)', () => {
  it('normalizes each field the way Meta documents', () => {
    expect(
      normalize({
        em: ' Ada@Example.COM ',
        ph: '+1 (415) 555-1234',
        zp: '94025-1234',
        fn: ' Ada ',
        ln: ' Lovelace ',
      })
    ).toMatchObject({
      em: 'ada@example.com',
      ph: '14155551234',
      zp: '94025',
      fn: 'ada',
      ln: 'lovelace',
    });
  });

  it('strips leading zeros from phone numbers', () => {
    expect(normalize({ ph: '0044 20 7946 0018' }).ph).toBe('442079460018');
  });

  it('removes spaces from city and state without eating letters', () => {
    // The old character class was /[s/-]/, which deleted every letter "s".
    expect(normalize({ ct: 'San Jose', st: 'B.C.', country: 'U S' })).toMatchObject({
      ct: 'sanjose',
      st: 'bc',
      country: 'us',
    });
  });
});

describe('mapRDTEvent', () => {
  it('maps purchase with the event id as the dedupe conversion id', () => {
    const [type, params] = mapRDTEvent('purchase', purchase, 'event-1');
    expect(type).toBe('Purchase');
    expect(params).toMatchObject({ conversionId: 'event-1', currency: 'USD', value: 99.5 });
  });

  it('sums item quantities into itemCount', () => {
    const [, params] = mapRDTEvent('add_to_cart', purchase, 'e');
    expect(params).toMatchObject({ itemCount: 3 });
  });

  it('falls back to Custom, keeping the original name', () => {
    const [type, params] = mapRDTEvent('started_trial', {}, 'event-1');
    expect(type).toBe('Custom');
    expect(params).toMatchObject({ customEventName: 'started_trial' });
  });

  it.each([
    ['page_view', 'PageVisit'],
    ['view_item', 'ViewContent'],
    ['search', 'Search'],
    ['sign_up', 'SignUp'],
    ['login', 'SignUp'],
  ] as const)('maps %s to %s carrying only the dedupe id', (internal, standard) => {
    const [type, params] = mapRDTEvent(internal, undefined, 'event-9');
    expect(type).toBe(standard);
    expect(params).toMatchObject({ conversionId: 'event-9' });
  });

  it('maps add_to_wishlist with value, currency and item count', () => {
    const [type, params] = mapRDTEvent('add_to_wishlist', purchase, 'e');
    expect(type).toBe('AddToWishlist');
    expect(params).toMatchObject({ currency: 'USD', value: 99.5, itemCount: 3 });
  });

  it('maps generate_lead with its value and uppercased currency', () => {
    const [type, params] = mapRDTEvent('generate_lead', { value: 10, currency: 'eur' }, 'e');
    expect(type).toBe('Lead');
    expect(params).toMatchObject({ value: 10, currency: 'EUR' });
  });

  it('a Custom event only extracts value/currency when they have the right types', () => {
    const [, params] = mapRDTEvent('weird', { value: 'high', currency: 42 }, 'e');
    expect(params).toMatchObject({ value: undefined, currency: undefined });
  });

  it('mapServerStandardEvent covers every pixel event name', () => {
    expect(mapServerStandardEvent('PageVisit')).toBe('PAGE_VISIT');
    expect(mapServerStandardEvent('ViewContent')).toBe('VIEW_CONTENT');
    expect(mapServerStandardEvent('Search')).toBe('SEARCH');
    expect(mapServerStandardEvent('AddToCart')).toBe('ADD_TO_CART');
    expect(mapServerStandardEvent('AddToWishlist')).toBe('ADD_TO_WISHLIST');
    expect(mapServerStandardEvent('Purchase')).toBe('PURCHASE');
    expect(mapServerStandardEvent('Lead')).toBe('LEAD');
    expect(mapServerStandardEvent('SignUp')).toBe('SIGN_UP');
  });
});

describe('mapOAIEvent', () => {
  it('maps the funnel names onto OpenAI event types', () => {
    expect(mapOAIEvent('purchase', purchase).type).toBe('order_created');
    expect(mapOAIEvent('add_to_cart', purchase).type).toBe('items_added');
    expect(mapOAIEvent('sign_up', { method: 'email' }).type).toBe('registration_completed');
  });

  it('falls back to custom', () => {
    expect(mapOAIEvent('whatever_else', {}).type).toBe('custom');
  });

  it.each([
    ['page_view', 'page_viewed'],
    ['view_item', 'contents_viewed'],
    ['view_item_list', 'contents_viewed'],
    ['begin_checkout', 'checkout_started'],
    ['generate_lead', 'lead_created'],
    ['qualify_lead', 'lead_created'],
    ['login', 'registration_completed'],
    ['schedule', 'appointment_scheduled'],
    ['subscribe', 'subscription_created'],
    ['trial_begin', 'trial_started'],
  ] as const)('maps %s to %s', (internal, standard) => {
    expect(mapOAIEvent(internal, undefined).type).toBe(standard);
  });

  it('converts the amount to minor units and uppercases the currency', () => {
    const { data } = mapOAIEvent('purchase', purchase);
    expect(data).toMatchObject({ type: 'contents', amount: 9950, currency: 'USD' });
    if (data.type !== 'contents') throw new Error('unreachable');
    expect(data.contents).toEqual([
      {
        id: 'sku-1',
        name: 'One',
        content_type: undefined,
        quantity: 1,
        amount: 4950,
        currency: 'USD',
      },
      {
        id: 'sku-2',
        name: 'Two',
        content_type: undefined,
        quantity: 2,
        amount: 2500,
        currency: 'USD',
      },
    ]);
  });

  it('subscriptions carry the first item id as the plan id', () => {
    const { data } = mapOAIEvent('subscribe', {
      value: 9.99,
      currency: 'usd',
      items: [{ item_id: 'plan-pro', item_name: 'Pro' }],
    });
    expect(data).toMatchObject({ type: 'plan_enrollment', plan_id: 'plan-pro', amount: 999 });
  });

  it('ignores value/currency/items of the wrong runtime type instead of crashing', () => {
    const { data } = mapOAIEvent('purchase', {
      value: 'high',
      currency: 7,
      items: 'nope',
    } as never);
    expect(data).toEqual({
      type: 'contents',
      amount: undefined,
      currency: undefined,
      contents: undefined,
    });
  });
});

describe('toMinorUnits', () => {
  it('uses the currency exponent: 2 by default, 0 and 3 for the exceptions', () => {
    expect(toMinorUnits(129.99, 'usd')).toBe(12999);
    expect(toMinorUnits(1000, 'JPY')).toBe(1000);
    expect(toMinorUnits(1.234, 'BHD')).toBe(1234);
    expect(toMinorUnits(10)).toBe(1000); // unknown currency falls back to 2 decimals
  });

  it('rounds half-up artifacts away and refuses non-numbers', () => {
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinorUnits(undefined, 'USD')).toBeUndefined();
    expect(toMinorUnits(null, 'USD')).toBeUndefined();
    expect(toMinorUnits(Number.NaN, 'USD')).toBeUndefined();
  });
});

describe('mapContents', () => {
  it('only stamps a currency on items that actually carry a price', () => {
    const contents = mapContents(
      [
        { item_id: 'a', item_name: 'A', price: 5 },
        { item_id: 'b', item_name: 'B' },
      ],
      'usd'
    );
    expect(contents).toEqual([
      {
        id: 'a',
        name: 'A',
        content_type: undefined,
        quantity: undefined,
        amount: 500,
        currency: 'USD',
      },
      {
        id: 'b',
        name: 'B',
        content_type: undefined,
        quantity: undefined,
        amount: undefined,
        currency: undefined,
      },
    ]);
  });

  it('answers undefined for a missing or empty list', () => {
    expect(mapContents(undefined, 'usd')).toBeUndefined();
    expect(mapContents([], 'usd')).toBeUndefined();
  });
});

describe('IGNORED_EVENTS', () => {
  it('keeps GA4 auto-collected and web-vitals events away from third parties', () => {
    for (const name of ['page_view', 'scroll', 'session_start', 'user_engagement', 'CLS', 'LCP']) {
      expect(IGNORED_EVENTS).toContain(name);
    }
  });

  it('does not ignore conversions', () => {
    for (const name of ['purchase', 'sign_up', 'generate_lead']) {
      expect(IGNORED_EVENTS).not.toContain(name);
    }
  });

  it('screen_view stays forwarded, React Native must send it manually', () => {
    expect(IGNORED_EVENTS).not.toContain('screen_view');
  });

  it('NON_AD_EVENTS keeps web vitals away from the OpenAI sender', () => {
    for (const name of ['CLS', 'LCP', 'TTFB']) expect(NON_AD_EVENTS).toContain(name);
  });
});
