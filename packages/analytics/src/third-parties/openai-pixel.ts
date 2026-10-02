import type { UpdateVisitorDTO } from '../schema/index';
import {
  NON_AD_EVENTS,
  type OAIQ,
  type OAIQUser,
  mapOAIEvent,
  normalizeOAIName,
  normalizeOAIPhone,
  oaiCustomEventName,
} from '../track/oaiq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import { sha256 } from '../utils/sha256';

declare global {
  interface Window {
    /** Undefined until the OpenAI pixel script has loaded. */
    oaiq?: OAIQ['oaiq'];
  }
}

/** Drop `undefined` fields so the SDK only receives populated values. */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function clean(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Forward an internal track event to the OpenAI measurement pixel.
 * `eventId` is reused as the OpenAI `event_id` so browser events deduplicate against the
 * Conversions API. https://developers.openai.com/ads/measurement-pixel
 */
export function sendOpenAIEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>,
  eventId?: string
) {
  if (typeof window === 'undefined' || !window.oaiq) {
    console.warn('oaiq has not been initialized');
    return;
  }
  if (NON_AD_EVENTS.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  const { type, data } = mapOAIEvent(name, properties);
  if (type === 'custom') {
    // Named as the Conversions API names it, so the two deduplicate; skipped when it cannot be.
    const custom_event_name = oaiCustomEventName(name);
    if (!custom_event_name) return;
    window.oaiq('measure', 'custom', clean(data), { event_id: eventId, custom_event_name });
  } else {
    window.oaiq('measure', type, clean(data), { event_id: eventId });
  }
}

/**
 * Re-initialize the pixel with hashed user identity for better conversion matching. Email, phone,
 * external id and names are normalized as OpenAI documents and hashed client-side; geographic
 * fields are sent raw. Hashing is asynchronous, so the `init` call is deferred until the digests
 * resolve.
 */
export function setOpenAIUser(pixelId: string) {
  return ({ user_id, user_data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.oaiq) {
      console.warn('oaiq has not been initialized');
      return;
    }
    // Capture the narrowed reference so the deferred `init` closure keeps it non-optional.
    const oaiq = window.oaiq;

    const email = getFirst(user_data?.email)?.trim().toLowerCase() || undefined;
    const phone = getFirst(user_data?.phone_number);
    const address = getFirst(user_data?.address);

    const base: OAIQUser = {
      country: address?.country?.trim().toUpperCase(),
      city: address?.city?.trim(),
      region: address?.region?.trim(),
      postal_code: address?.postal_code?.trim(),
    };

    const init = (hashed: Partial<OAIQUser>) => {
      oaiq('init', { pixelId, user: clean({ ...base, ...hashed }) });
    };

    const hash = (value: string | undefined) => (value ? sha256(value) : undefined);
    Promise.all([
      hash(email),
      hash(phone ? normalizeOAIPhone(phone) : undefined),
      hash(user_id?.trim()),
      hash(normalizeOAIName(address?.first_name)),
      hash(normalizeOAIName(address?.last_name)),
    ])
      .then(([email_sha256, phone_number_sha256, external_id_sha256, first, last]) =>
        init({
          email_sha256,
          phone_number_sha256,
          external_id_sha256,
          first_name_sha256: first,
          last_name_sha256: last,
        })
      )
      .catch(() => init({}));
  };
}
