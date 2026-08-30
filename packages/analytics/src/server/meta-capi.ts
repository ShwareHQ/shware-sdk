/**
 * Meta Conversions API sender built on `capi-param-builder-nodejs` and plain `fetch`, replacing
 * the 31MB `facebook-nodejs-business-sdk` with ~0.5MB of parameter building. `sendMetaEvents`
 * stays exported and untouched; this module is the drop-in successor hosts opt into.
 *
 * The wire payload is byte-identical to what the business SDK's `ServerEvent.normalize()`
 * produces — enforced by a differential test that runs both builders over the same events.
 * Where the two libraries normalize differently (the business SDK keeps punctuation in names,
 * spaces in multi-word last names, accents in cities; the param builder strips them per the
 * current documented rules), this module follows the business SDK so that switching senders
 * cannot change a single hash Meta receives. The param builder is used where the two provably
 * agree — email, phone, gender, country — and its adoption-tracking appendix (`<hash>.<token>`)
 * is stripped for the same reason.
 *
 * Two deliberate behavior differences from the business SDK, both on invalid input only:
 * an invalid field (malformed email, non-ISO country, letters in a phone) is dropped from
 * user_data instead of throwing inside `execute()` and costing the whole batch; an invalid
 * currency is uppercased and forwarded instead of rejected. Valid input is unaffected.
 *
 * https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
import { createHash } from 'node:crypto';
import { fetch } from '@shware/utils';
import { PII_DATA_TYPE, ParamBuilder } from 'capi-param-builder-nodejs';
import { formatFbc } from '../click-id/index';
import { IGNORED_EVENTS } from '../third-parties/ignored-events';
import { mapFBEvent } from '../track/fbq';
import type { TrackEvent, TrackTags, UserProvidedData } from '../track/types';
import { resolveActionSource } from './action-source';
import { pageLocation } from './page-location';

/** Matches the Graph API version the pinned business SDK speaks (`FacebookAdsApi.VERSION`). */
const API_VERSION = 'v24.0';

const USER_ASSIGNED_COUNTRIES: string[] = ['xk'];
function normalizeCountry(input: string | undefined): string | undefined {
  const country = input?.split(/[-_]/).at(0)?.toLowerCase();
  if (!country) return undefined;
  return USER_ASSIGNED_COUNTRIES.includes(country) ? undefined : country;
}

/**
 * Lazy for the same reason as the session and the token bucket (see setup/session.ts):
 * Cloudflare Workers refuse some work in module scope, and nothing here is per-request state.
 */
let paramBuilder: ParamBuilder | undefined;

/**
 * Normalize and hash one PII value through the param builder, stripped to the bare SHA-256 the
 * business SDK sends: the builder appends a `.<language-token>` adoption marker that Meta's
 * endpoint tolerates but the business SDK never produced. Pre-hashed input passes through, as
 * it does in the business SDK.
 */
function pii(value: string | undefined, dataType: string): string | undefined {
  if (!value) return undefined;
  const built = (paramBuilder ??= new ParamBuilder()).getNormalizedAndHashedPII(value, dataType);
  return built?.split('.').at(0) ?? undefined;
}

const SHA256_OR_MD5 = /^[a-f0-9]{64}$|^[a-f0-9]{32}$/;

/**
 * The business SDK's `normalizeAndHash` for the fields where the param builder normalizes
 * differently (names, city, state, zip): trim + lowercase, pass a pre-hashed value through,
 * apply the field rule, SHA-256. Field rules are copied from `ServerSideUtils` verbatim so the
 * differential test can hold the outputs equal.
 */
function hashed(
  input: string | undefined,
  rule: (lowered: string) => string | undefined
): string | undefined {
  if (!input) return undefined;
  const lowered = input.trim().toLowerCase();
  if (!lowered) return undefined;
  if (SHA256_OR_MD5.test(lowered)) return lowered;
  const normalized = rule(lowered);
  if (normalized === undefined) return undefined;
  return createHash('sha256').update(normalized).digest('hex');
}

const nameRule = (v: string) => v;
const f5Rule = (v: string) => (v.length <= 5 ? v : v.slice(0, 5));
const cityStateRule = (v: string) => v.replace(/[0-9\s().-]/g, '');
const zipRule = (v: string) => {
  const zip = v.replace(/\s/g, '').split('-', 1)[0];
  return zip.length < 2 ? undefined : zip;
};

/**
 * Every multi-value field is deduplicated after hashing, order preserved — the SDK runs each
 * through `dedupArray` (a Set), `external_id` included.
 */
const dedupe = (hashes: (string | undefined)[]) =>
  Array.from(new Set(hashes.filter((hash): hash is string => hash !== undefined)));

const list = (hashes: (string | undefined)[]) => {
  const deduped = dedupe(hashes);
  return deduped.length > 0 ? deduped : undefined;
};

interface CapiUserData {
  em?: string[];
  ph?: string[];
  ge?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  zp?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
  fb_login_id?: string;
  page_id?: string;
  f5first?: string;
  f5last?: string;
  dobd?: string;
  dobm?: string;
  doby?: string;
  madid?: string;
}

function getUserData(tags: TrackTags, data: UserProvidedData, eventTimeMs: number): CapiUserData {
  const userData: CapiUserData = {};

  if (data.email) {
    const emails = Array.isArray(data.email) ? data.email : [data.email];
    userData.em = list(emails.map((email) => pii(email, PII_DATA_TYPE.EMAIL)));
  }
  if (data.phone_number) {
    const phones = Array.isArray(data.phone_number) ? data.phone_number : [data.phone_number];
    userData.ph = list(phones.map((phone) => pii(phone, PII_DATA_TYPE.PHONE)));
  }
  if (data.gender === 'female' || data.gender === 'male') {
    userData.ge = list([pii(data.gender === 'female' ? 'f' : 'm', PII_DATA_TYPE.GENDER)]);
  }
  if (data.address) {
    if (Array.isArray(data.address)) {
      // The SDK sets these lists unconditionally in the multi-address branch, so an all-empty
      // column still goes out as `[]` — kept for byte-equality with the current sender.
      userData.fn = dedupe(data.address.map((a) => hashed(a.first_name, nameRule)));
      userData.ln = dedupe(data.address.map((a) => hashed(a.last_name, nameRule)));
      userData.ct = dedupe(data.address.map((a) => hashed(a.city, cityStateRule)));
      userData.st = dedupe(data.address.map((a) => hashed(a.region, cityStateRule)));
      userData.zp = dedupe(data.address.map((a) => hashed(a.postal_code, zipRule)));
      userData.country = dedupe(
        data.address.map((a) => pii(normalizeCountry(a.country), PII_DATA_TYPE.COUNTRY))
      );
    } else {
      userData.fn = list([hashed(data.address.first_name, nameRule)]);
      userData.ln = list([hashed(data.address.last_name, nameRule)]);
      userData.ct = list([hashed(data.address.city, cityStateRule)]);
      userData.st = list([hashed(data.address.region, cityStateRule)]);
      userData.zp = list([hashed(data.address.postal_code, zipRule)]);
      userData.country = list([pii(normalizeCountry(data.address.country), PII_DATA_TYPE.COUNTRY)]);
      // The 5-character prefixes, exactly as the current sender builds them: sliced first, then
      // normalized. Only the single-address branch sets them, as before.
      userData.f5first = hashed(data.address.first_name?.slice(0, 5), f5Rule);
      userData.f5last = hashed(data.address.last_name?.slice(0, 5), f5Rule);
    }
  }
  if (data.birthday) {
    const { year, month, day } = data.birthday;
    if (/^\d{4}$/.test(year.toString())) {
      userData.doby = createHash('sha256').update(year.toString()).digest('hex');
    }
    if (month >= 1 && month <= 12) {
      userData.dobm = createHash('sha256').update(month.toString().padStart(2, '0')).digest('hex');
    }
    if (day >= 1 && day <= 31) {
      userData.dobd = createHash('sha256').update(day.toString().padStart(2, '0')).digest('hex');
    }
  }
  if (data.user_id && data.user_id.length !== 0) {
    // Unhashed, as the business SDK sends it. Meta documents hashing as recommended, not
    // required; changing it here would break continuity with every event sent so far.
    userData.external_id = [data.user_id];
  }
  if (data.ip_address) {
    userData.client_ip_address = data.ip_address;
  }
  if (data.user_agent) {
    userData.client_user_agent = data.user_agent;
  }
  if (data.fb_login_id) {
    userData.fb_login_id = data.fb_login_id;
  }
  if (data.fb_page_id) {
    userData.page_id = data.fb_page_id;
  }

  if (tags.fbc) {
    userData.fbc = tags.fbc;
  } else if (tags.fbclid) {
    userData.fbc = formatFbc(tags.fbclid, eventTimeMs);
  }
  if (tags.fbp) {
    userData.fbp = tags.fbp;
  }
  if (tags.advertising_id) {
    userData.madid = tags.advertising_id;
  }
  if (tags.ip_address && typeof tags.ip_address === 'string') {
    userData.client_ip_address = tags.ip_address;
  }

  return userData;
}

const DELIVERY_CATEGORIES = ['in_store', 'curbside', 'home_delivery'];

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function getCustomData({ name, properties }: TrackEvent<any>): Record<string, unknown> {
  const [_, _name, fbEventProperties] = mapFBEvent(name, properties);
  const {
    value,
    currency,
    content_name,
    content_category,
    content_ids,
    contents,
    content_type,
    predicted_ltv,
    num_items,
    search_string,
    status,
    delivery_category,
    ...custom_properties
  } = fbEventProperties;

  const customData: Record<string, unknown> = {};
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- custom event properties may carry `value: null` at runtime despite the declared type
  if (value !== undefined && value !== null && Number.isFinite(Number.parseFloat(String(value)))) {
    customData.value = Number.parseFloat(String(value));
  }
  if (currency) {
    // The business SDK also validates against the ISO 4217 list and throws; here an unknown
    // code is forwarded uppercased rather than costing the batch.
    customData.currency = currency
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
  }
  if (content_name) customData.content_name = content_name;
  if (content_category) customData.content_category = content_category;
  if (content_ids) customData.content_ids = content_ids;
  if (contents) {
    customData.contents = contents.map((c) => {
      const content: Record<string, unknown> = {};
      if (c.id) content.id = c.id;
      if (c.quantity) content.quantity = c.quantity;
      if (c.item_price) content.item_price = c.item_price;
      if (c.title) content.title = c.title;
      if (c.description) content.description = c.description;
      if (c.brand) content.brand = c.brand;
      if (c.category) content.category = c.category;
      const delivery = c.delivery_category?.trim().toLowerCase();
      if (delivery && DELIVERY_CATEGORIES.includes(delivery)) content.delivery_category = delivery;
      return content;
    });
  }
  if (content_type) customData.content_type = content_type;
  if (predicted_ltv) customData.predicted_ltv = predicted_ltv;
  if (num_items) customData.num_items = num_items;
  if (search_string) customData.search_string = search_string;
  if (status) customData.status = status.toString();
  const delivery = delivery_category?.trim().toLowerCase();
  if (delivery && DELIVERY_CATEGORIES.includes(delivery)) customData.delivery_category = delivery;

  return { ...customData, ...custom_properties };
}

/**
 * `extinfo` is keyed by field index. The business SDK builds the same object and leaves unset
 * indexes out when it serializes; the documented 16-element array is what the Graph endpoint
 * decodes this into. Indexes: 0 version, 1 package, 2 short version, 3 long version, 4 OS
 * version, 5 device model, 6 locale, 9 screen width, 10 height, 11 density.
 */
function getAppData(tags: TrackTags, appPackageName: string): Record<string, unknown> {
  const extinfo: Record<number, string | number> = {};
  if (tags.os_name === 'iOS' || tags.os_name === 'iPadOS') {
    extinfo[0] = 'i2';
  } else if (tags.os_name === 'Android') {
    extinfo[0] = 'a2';
  }
  extinfo[1] = appPackageName;
  const shortVersion = tags.release?.split('.').at(0);
  if (shortVersion) extinfo[2] = shortVersion;
  if (tags.release) extinfo[3] = tags.release;
  if (tags.os_version) extinfo[4] = tags.os_version;
  if (tags.device_model_id) extinfo[5] = tags.device_model_id;
  if (tags.language) extinfo[6] = tags.language;
  if (tags.screen_width) extinfo[9] = tags.screen_width;
  if (tags.screen_height) extinfo[10] = tags.screen_height;
  if (tags.device_pixel_ratio) extinfo[11] = tags.device_pixel_ratio.toString();

  const appData: Record<string, unknown> = { extinfo };
  if (tags.advertising_id) appData.advertiser_tracking_enabled = true;
  if (tags.install_referrer) appData.install_referrer = tags.install_referrer;
  return appData;
}

/** One entry of the `data` array POSTed to `/{pixel_id}/events`. */
export interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url?: string;
  action_source: 'app' | 'website' | 'other';
  user_data: CapiUserData;
  custom_data: Record<string, unknown>;
  app_data?: Record<string, unknown>;
}

/**
 * `action_source` is derived from `event.platform` alone: an OS platform is an app, `web` is a
 * website, and everything else — including a backend-built offline conversion, which should
 * declare `platform: 'unknown'` — lands in Meta's `other`, exactly where the business-SDK
 * sender put an explicit `'offline'` too.
 */
export function getCapiEvent(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  event: TrackEvent<any>,
  data: UserProvidedData,
  appPackageName?: string
): CapiEvent {
  const eventTimeMs = new Date(event.created_at).getTime();
  const [_, eventName] = mapFBEvent(event.name, event.properties);
  const source = resolveActionSource(event.platform);

  const capiEvent: CapiEvent = {
    event_name: eventName,
    event_time: Math.round(eventTimeMs / 1000),
    event_id: event.tags.idempotency_key ?? event.id,
    // `action_source` is required; an offline conversion and an undeterminable platform both
    // land in Meta's catch-all, exactly as in the business-SDK sender.
    action_source: source === 'app' ? 'app' : source === 'web' ? 'website' : 'other',
    user_data: getUserData(event.tags, data, eventTimeMs),
    custom_data: getCustomData(event),
  };
  if (source === 'app' && appPackageName) {
    capiEvent.app_data = getAppData(event.tags, appPackageName);
  }
  const eventSourceUrl = pageLocation(event.tags);
  if (eventSourceUrl) {
    capiEvent.event_source_url = eventSourceUrl;
  }
  return capiEvent;
}

export interface MetaConversionsOptions {
  /** Attaches `app_data`/extinfo to events whose platform resolves to an app. */
  appPackageName?: string;
  /** Routes the batch to Events Manager's Test Events tab instead of production. */
  testEventCode?: string;
  /** Graph API version, e.g. 'v24.0'. */
  apiVersion?: string;
}

export interface MetaConversionsResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
}

/**
 * The lightweight counterpart to `sendMetaEvents`: same filtering, same payload, same
 * never-throws contract, minus the 31MB SDK. The token travels in the JSON body, never in the
 * URL, and is never logged.
 */
export async function sendMetaConversions(
  accessToken: string,
  pixelId: string,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  events: TrackEvent<any>[],
  data: UserProvidedData = {},
  options: MetaConversionsOptions = {}
): Promise<MetaConversionsResponse | undefined> {
  const capiEvents = events
    .filter((event) => !IGNORED_EVENTS.includes(event.name))
    .map((event) => getCapiEvent(event, data, options.appPackageName));
  if (capiEvents.length === 0) return undefined;

  const version = options.apiVersion ?? API_VERSION;
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        data: capiEvents,
        test_event_code: options.testEventCode,
        access_token: accessToken,
      }),
    });
    if (response.ok) return (await response.json()) as MetaConversionsResponse;
    const { status } = response;
    const message = await response.text();
    console.error(`Failed to send Meta conversion, status: ${status}, body: ${message}`);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send Meta conversion, network error: ${message}`);
    return undefined;
  }
}
