/**
 * OpenAI Conversions API
 * https://developers.openai.com/ads/conversions-api
 * https://developers.openai.com/ads/supported-events
 */
import { createHash } from 'crypto';
import { fetch } from '@shware/utils';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { type EventData, mapOAIEvent } from '../track/oaiq';
import type { TrackEvent, TrackTags, UserProvidedData } from '../track/types';
import { getFirst } from '../utils/field';

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
 * User/identity fields. Email and external id must be sent as lowercase 64-char SHA-256 hex
 * strings; geographic, IP, and user-agent fields are sent as raw values.
 */
export interface OpenAIUser {
  email_sha256?: string;
  external_id_sha256?: string;
  /** Two-letter ISO 3166-1 country code (e.g. "US"). */
  country?: string;
  city?: string;
  zip_code?: string;
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

function mapActionSource(source: TrackTags['source']): ActionSource | undefined {
  switch (source) {
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

function getUser(data: UserProvidedData): OpenAIUser | undefined {
  const email = getFirst(data.email)?.trim().toLowerCase();
  const address = getFirst(data.address);

  const user: OpenAIUser = {
    email_sha256: email ? sha256(email) : undefined,
    external_id_sha256: data.user_id ? sha256(data.user_id) : undefined,
    country: address?.country?.trim().toUpperCase(),
    city: address?.city?.trim().toLowerCase(),
    zip_code: address?.postal_code,
    ip_address: data.ip_address,
    user_agent: data.user_agent,
  };

  return Object.values(user).some((value) => value !== undefined) ? user : undefined;
}

export function getServerEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData
): OpenAIEvent {
  const { type, data: eventData } = mapOAIEvent(event.name, event.properties);

  return {
    id: event.tags.idempotency_key ?? event.id.toString(),
    type,
    // For custom events the original track name is the OpenAI custom_event_name; this matches
    // the browser pixel so the two deduplicate. Standard events omit it.
    custom_event_name: type === 'custom' ? event.name : undefined,
    timestamp_ms: Date.now(),
    source_url: event.tags.source_url,
    action_source: mapActionSource(event.tags.source),
    user: getUser(data),
    data: eventData,
  };
}

export async function sendEvents(
  apiKey: string,
  pixelId: string,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  validateOnly = false
) {
  const dto: CreateOpenAIEventsDTO = {
    validate_only: validateOnly,
    events: events
      .filter((event) => !IGNORED_EVENTS.includes(event.name))
      .map((event) => getServerEvent(event, data)),
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
