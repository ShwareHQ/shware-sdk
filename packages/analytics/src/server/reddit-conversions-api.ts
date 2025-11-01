import { mapRDTEvent, mapServerStandardEvent } from '../track/rdt';
import { fetch } from '../utils/fetch';
import { getFirst } from '../utils/field';
import type { ServerStandardEvent } from '../track/rdt';
import type { TrackEvent, UserProvidedData } from '../track/types';

/**
 * https://ads-api.reddit.com/docs/v3/operations/Post%20Conversion%20Events
 * https://business.reddithelp.com/s/article/map-a-catalog-to-a-signal-source
 */
export interface RedditEvent {
  /** Match keys: Share user identifiers to match conversions to a Reddit ad engagement. */
  click_id?: string;

  /** Unix epoch timestamp in milliseconds, event_at can't be older than seven days. */
  event_at: number;

  action_source: 'WEBSITE' | 'APP' | string;

  type: {
    tracking_type: ServerStandardEvent | 'CUSTOM';
    custom_event_name?: string;
  };

  /**
   * Event metadata
   * Share as much additional information about your conversion event as you'd like. If you're
   * using the Conversions API with the pixel, conversion_id is required for deduplication.
   */
  metadata?: {
    conversion_id?: string;
    currency?: string; // ISO 4217 3-letter currency code
    item_count?: number;
    value?: number;
    products?: { id: string; name?: string; category?: string }[];
  };

  user?: {
    email?: string;
    external_id?: string;
    ip_address?: string;
    phone_number?: string;
    user_agent?: string;

    /** The Identifier for Advertisers (IDFA) of the user's Apple device. */
    idfa?: string;

    /** The Android Advertising ID (AAID) of the user's Android device. */
    aaid?: string;
    /**
     * The value from the first-party Pixel _rdt_uuid cookie on your domain. Note that it is in
     * the {timestamp}.{uuid} format. You may use the full value or just the UUID portion.
     * Example: 1684189007728.7c73f2ae-a433-4d7b-9838-f467da98f48e
     */
    uuid?: string;

    screen_dimensions?: { width: number; height: number };

    /**
     * A structure of data processing options to specify the processing type for the event
     * https://business.reddithelp.com/s/article/Limited-Data-Use
     */
    data_processing_options?: {
      country: string;
      region: string;
      modes: string[] | ['LDU'];
    };
  };
}

export interface CreateRedditEventDTO {
  data: { test_id?: string; events: RedditEvent[] };
}

export function getServerEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData
): RedditEvent {
  const { id, name, properties, tags } = event;
  const [type, params] = mapRDTEvent(name, properties, id);

  return {
    click_id: tags.rdt_cid,
    event_at: Date.now(),
    action_source: tags.source === 'web' ? 'WEBSITE' : tags.source === 'app' ? 'APP' : 'UNKNOWN',
    type: {
      tracking_type: type === 'Custom' ? 'CUSTOM' : mapServerStandardEvent(type),
      custom_event_name: type === 'Custom' ? params.customEventName : undefined,
    },
    metadata: {
      conversion_id: id,
      currency:
        'currency' in params && typeof params.currency === 'string'
          ? params.currency.toUpperCase()
          : undefined,
      item_count:
        'itemCount' in params && typeof params.itemCount === 'number'
          ? params.itemCount
          : undefined,
      value: 'value' in params && typeof params.value === 'number' ? params.value : undefined,
      products:
        'products' in params && Array.isArray(params.products) && params.products.length > 0
          ? params.products
          : undefined,
    },
    user: {
      email: getFirst(data.email),
      external_id: data.user_id,
      ip_address: data.ip_address,
      phone_number: getFirst(data.phone_number),
      user_agent: data.user_agent,
      idfa: tags.platform === 'ios' ? tags.advertising_id : undefined,
      aaid: tags.platform === 'android' ? tags.advertising_id : undefined,
      uuid: tags.rdt_uuid,
      screen_dimensions:
        tags.screen_width && tags.screen_height
          ? { width: tags.screen_width, height: tags.screen_height }
          : undefined,
    },
  };
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

export async function sendEvents(
  accessToken: string,
  pixelId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  testId?: string
) {
  const dto: CreateRedditEventDTO = {
    data: {
      test_id: testId,
      events: events
        .filter((event) => !metrics.includes(event.name))
        .map((event) => getServerEvent(event, data)),
    },
  };

  if (dto.data.events.length === 0) return;

  const response = await fetch(
    `https://ads-api.reddit.com/api/v3/pixels/${pixelId}/conversion_events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    }
  );

  if (!response.ok) {
    console.error('Failed to send Reddit conversion events:', await response.text());
  }
}
