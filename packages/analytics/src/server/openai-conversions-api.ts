/**
 * OpenAI Conversions API
 * https://developers.openai.com/ads/conversions-api
 * https://developers.openai.com/ads/supported-events
 */
import { createHash } from 'node:crypto';
import { fetch } from '@shware/utils';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import {
  type EventData,
  NON_AD_EVENTS,
  mapOAIEvent,
  normalizeOAIName,
  normalizeOAIPhone,
  oaiCustomEventName,
} from '../track/oaiq';
import type { Platform, TrackEvent, UserProvidedData } from '../track/types';
import { type EventActionSource, resolveActionSource } from './action-source';
import { openaiOppref } from './click-ids';
import { pageLocation } from './page-location';

const ENDPOINT = 'https://bzr.openai.com/v1/events';

type ActionSource =
  | 'web'
  | 'mobile_app'
  | 'offline'
  | 'physical_store'
  | 'phone_call'
  | 'email'
  | 'other';

/**
 * Conversion-matching fields, all optional. Identifiers are normalized, then sent as lowercase
 * 64-char SHA-256 hex strings; geographic values are raw. Of each list the API uses the first
 * three valid, unique values.
 * ref: https://developers.openai.com/ads/conversions-api#send-user-data
 */
export interface OpenAIUser {
  /** The pixel's `__obref` cookie, unhashed; ties the server event to the pixel's browser. */
  obref?: string;
  emails_sha256?: string[];
  /** 8–15 digits with the country code, no leading `+` or zeroes. */
  phone_numbers_sha256?: string[];
  external_ids_sha256?: string[];
  first_names_sha256?: string[];
  last_names_sha256?: string[];
  regions?: string[];
  postal_codes?: string[];
  cities?: string[];
  /** Two-letter ISO 3166-1 country codes (e.g. "US"). */
  countries?: string[];
  /** Android GAID only; IDFA is not supported. */
  android_advertising_id?: string;
  ip_address?: string;
  user_agent?: string;
}

export interface OpenAIEvent {
  /** Unique event id; combined with `type` for deduplication against pixel events. */
  id: string;
  /** Standard event name or `custom`. */
  type: string;
  /** Required when `type` is `custom`. */
  custom_event_name?: string;
  /** Event timestamp in ms; must be within 7 days and no more than 10 minutes in the future. */
  timestamp_ms: number;
  /** Required for `action_source: "web"`. */
  source_url?: string;
  action_source?: ActionSource;
  /** OpenAI-provided privacy-preserving identifier. */
  oppref?: string;
  /** When true, opts the event out of personalization. */
  opt_out?: boolean;
  user?: OpenAIUser;
  data: EventData;
}

export interface CreateOpenAIEventsDTO {
  /** When true, validates the events without persisting them. */
  validate_only?: boolean;
  events: OpenAIEvent[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mapActionSource(
  platform: Platform,
  actionSource?: EventActionSource
): ActionSource | undefined {
  switch (resolveActionSource(platform, actionSource)) {
    case 'web':
      return 'web';
    case 'app':
      return 'mobile_app';
    case 'offline':
      return 'offline';
    default:
      return undefined;
  }
}

function list<T>(field: T | T[] | undefined): T[] {
  if (!field) return [];
  return Array.isArray(field) ? field : [field];
}

/** The distinct non-empty values, or undefined when there are none. */
function values(items: (string | undefined)[]): string[] | undefined {
  const result = [...new Set(items.filter((item): item is string => !!item))];
  return result.length > 0 ? result : undefined;
}

function getUser(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData
): OpenAIUser | undefined {
  const hashed = (items: (string | undefined)[]) => values(items)?.map(sha256);
  const addresses = list(data.address);

  const user: OpenAIUser = {
    obref: event.tags.__obref,
    emails_sha256: hashed(list(data.email).map((email) => email.trim().toLowerCase())),
    phone_numbers_sha256: hashed(list(data.phone_number).map(normalizeOAIPhone)),
    external_ids_sha256: hashed([data.user_id?.trim()]),
    first_names_sha256: hashed(addresses.map((a) => normalizeOAIName(a.first_name))),
    last_names_sha256: hashed(addresses.map((a) => normalizeOAIName(a.last_name))),
    regions: values(addresses.map((a) => a.region?.trim())),
    postal_codes: values(addresses.map((a) => a.postal_code?.trim())),
    cities: values(addresses.map((a) => a.city?.trim())),
    countries: values(addresses.map((a) => a.country?.trim().toUpperCase())),
    android_advertising_id:
      event.platform === 'android' ? event.tags.advertising_id || undefined : undefined,
    ip_address: data.ip_address,
    user_agent: data.user_agent,
  };

  return Object.values(user).some((value) => value !== undefined) ? user : undefined;
}

export function getServerEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData,
  actionSource?: EventActionSource
): OpenAIEvent {
  const { type, data: eventData } = mapOAIEvent(event.name, event.properties);

  return {
    id: event.tags.idempotency_key ?? event.id,
    type,
    // For custom events the track name, made valid (`oaiCustomEventName`); the browser pixel
    // names it the same way, so the two deduplicate. Standard events omit it.
    custom_event_name: type === 'custom' ? oaiCustomEventName(event.name) : undefined,
    timestamp_ms: new Date(event.created_at).getTime(),
    source_url: pageLocation(event.tags),
    // The click id OpenAI appends to an ad's landing URL; what ties the conversion to the click.
    oppref: openaiOppref(event.tags),
    action_source: mapActionSource(event.platform, actionSource),
    user: getUser(event, data),
    data: eventData,
  };
}

/**
 * `timestamp_ms` "must be within the last 7 days and no more than 10 minutes in the future", or
 * the request fails; such an event is left out, with a minute's margin for the trip.
 */
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 1000;
const MAX_EVENT_AHEAD_MS = 10 * 60 * 1000;

export async function sendEvents(
  apiKey: string,
  pixelId: string,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  validateOnly = false,
  actionSource?: EventActionSource
) {
  const dto: CreateOpenAIEventsDTO = {
    validate_only: validateOnly,
    events: events
      .filter((event) => !IGNORED_EVENTS.includes(event.name))
      .filter((event) => !NON_AD_EVENTS.includes(event.name))
      .filter((event) => {
        const age = Date.now() - Date.parse(event.created_at);
        return age <= MAX_EVENT_AGE_MS && age >= -MAX_EVENT_AHEAD_MS;
      })
      .map((event) => getServerEvent(event, data, actionSource))
      // A custom event whose name cannot be made valid would fail the whole request.
      .filter((event) => event.type !== 'custom' || event.custom_event_name !== undefined),
  };

  if (dto.events.length === 0) return;

  try {
    const response = await fetch(`${ENDPOINT}?pid=${pixelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(dto),
    });

    if (response.ok) return;
    const { status } = response;
    const message = await response.text();
    console.error(`Failed to send OpenAI conversion, status: ${status}, body: ${message}`);
  } catch (error) {
    console.error('Failed to send OpenAI conversion, network error:', error);
  }
}
