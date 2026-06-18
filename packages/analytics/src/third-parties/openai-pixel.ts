import { type OAIQ, type OAIQUser, mapOAIEvent } from '../track/oaiq';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';
import type { UpdateVisitorDTO } from '../visitor/types';

declare global {
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface Window extends OAIQ {}
}

const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

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
  if (metrics.includes(name)) return;
  if (window.location.host.includes('127.0.0.1')) return;
  if (window.location.host.includes('localhost')) return;

  const { type, data } = mapOAIEvent(name, properties);
  if (type === 'custom') {
    window.oaiq('measure', 'custom', clean(data), { event_id: eventId, custom_event_name: name });
  } else {
    window.oaiq('measure', type, clean(data), { event_id: eventId });
  }
}

/** SHA-256 hex digest, lowercase — the format OpenAI expects for hashed identity fields. */
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Re-initialize the pixel with hashed user identity for better conversion matching. Email and
 * external id are hashed client-side; geographic fields are sent raw. Hashing is asynchronous,
 * so the `init` call is deferred until the digests resolve.
 */
export function setOpenAIUser(pixelId: string) {
  return ({ user_id, data }: UpdateVisitorDTO) => {
    if (typeof window === 'undefined' || !window.oaiq) {
      console.warn('oaiq has not been initialized');
      return;
    }

    const email = getFirst(data?.email)?.trim().toLowerCase();
    const address = getFirst(data?.address);

    const base: OAIQUser = {
      country: address?.country?.trim().toUpperCase(),
      city: address?.city?.trim().toLowerCase(),
      zip_code: address?.postal_code,
    };

    const init = (hashed: Partial<OAIQUser>) => {
      window.oaiq('init', { pixelId, user: clean({ ...base, ...hashed }) });
    };

    Promise.all([email ? sha256(email) : undefined, user_id ? sha256(user_id) : undefined])
      .then(([email_sha256, external_id_sha256]) => init({ email_sha256, external_id_sha256 }))
      .catch(() => init({}));
  };
}
