import {
  enum as _enum,
  null as _null,
  array,
  boolean,
  e164,
  email,
  iso,
  maxLength,
  minLength,
  number,
  object,
  optional,
  pipe,
  record,
  regex,
  string,
  toLowerCase,
  toUpperCase,
  transform,
  trim,
  union,
  url,
  uuid,
  type z,
} from 'zod/mini';
import type { Environment, Platform } from '../track/types';

const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 512;
const MAX_PROPERTIES = 64;

/**
 * Truncated rather than rejected. These schemas validate a whole batch at once, so refusing one
 * oversized value costs every event that traveled with it — and the values that overrun are the
 * ones derived from the page (a link's text, a URL carrying a long query), which no client can
 * bound in advance. A shortened value is worth more than a lost batch.
 */
const propertyText = pipe(
  string(),
  transform((value) => value.slice(0, MAX_VALUE_LENGTH))
);

/**
 * Tags are truncated for the same reason property values are, and they are stored more than once
 * (on the event, the session and the visitor), so an unbounded one costs several times over.
 * 1024 sits just above what GA4 itself keeps (1000 characters of page_location, 420 of
 * page_referrer, 300 of page_title). Real tags stay under ~500 characters; the rare longer ones
 * are page_referrer values from search and ad redirect URLs, where the kept prefix — host and
 * path — is the part that matters.
 */
const MAX_TAG_LENGTH = 1024;

const tagText = pipe(
  string(),
  transform((value) => value.slice(0, MAX_TAG_LENGTH))
);

/**
 * Keys are written by hand in instrumentation code, so an unusable one is a mistake in the host
 * rather than something the visitor typed. It is still dropped rather than rejected, for the same
 * reason: the mistake should cost that property, not the batch it happens to be in. Truncating a
 * key is not an option — two long keys would silently become one field.
 *
 * The key schema below is deliberately permissive so that this transform is reached at all; the
 * trimming it used to do happens here instead. `MAX_PROPERTIES` keeps the first N in insertion
 * order.
 */
function takeProperties<T>(data: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  let count = 0;
  for (const [rawKey, value] of Object.entries(data)) {
    if (count >= MAX_PROPERTIES) break;
    const key = rawKey.trim();
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    result[key] = value;
    count++;
  }
  return result;
}

/**
 * Capped at GA4's own item-list limit, and truncated rather than rejected like every other
 * property limit here: an unbounded array is the one field a caller could still blow a batch
 * up with after the value and key limits.
 */
const MAX_ITEMS = 200;

const items = pipe(
  array(
    pipe(
      record(string(), union([propertyText, number(), boolean(), _null()])),
      transform(takeProperties)
    )
  ),
  transform((list) => list.slice(0, MAX_ITEMS))
);

export const ALL_PLATFORMS = [
  'ios',
  'android',
  'web',
  'macos',
  'windows',
  'linux',
  'unknown',
] as const satisfies Platform[];

export const ALL_ENVIRONMENTS = ['development', 'production'] as const satisfies Environment[];

export const tagsSchema = object({
  os: optional(tagText),
  os_name: optional(tagText),
  os_version: optional(tagText),
  browser: optional(tagText),
  browser_name: optional(tagText),
  browser_version: optional(tagText),
  device: optional(tagText),
  device_id: optional(string().check(trim(), minLength(1), maxLength(36))),
  device_type: optional(tagText),
  device_vendor: optional(tagText),
  device_pixel_ratio: optional(number()),
  screen_width: optional(number()),
  screen_height: optional(number()),
  screen_resolution: optional(
    pipe(
      string().check(regex(/^\d+x\d+$/)),
      transform((v) => v as `${number}x${number}`)
    )
  ),
  webdriver: optional(boolean()),
  release: optional(tagText),
  language: optional(tagText),
  time_zone: optional(tagText),
  page_location: optional(tagText),
  page_referrer: optional(tagText),
  page_title: optional(tagText),
  page_load_id: optional(tagText),
  /**
   * @deprecated Renamed to `page_location` in 7.0.0. Accepted so that events from clients
   * still on an older SDK are not stripped of their page URL at this boundary — a browser
   * bundle stays cached long after a backend deploys. Remove once those clients are gone;
   * `pageLocation` in `server/page-location.ts` is the only reader.
   */
  // oxlint-disable-next-line typescript/no-deprecated -- Legacy input from pre-7.0 clients must survive validation.
  source_url: optional(tagText),
  // app info
  advertising_id: optional(tagText),
  install_referrer: optional(tagText),
  // Ad click ids (URL parameters) and ad platform cookies (underscore names); see AdvertisingInfo.
  // Meta Ads
  fbclid: optional(tagText),
  ad_id: optional(tagText),
  ad_name: optional(tagText),
  adset_id: optional(tagText),
  adset_name: optional(tagText),
  campaign_id: optional(tagText),
  campaign_name: optional(tagText),
  placement: optional(tagText),
  _fbc: optional(tagText),
  _fbp: optional(tagText),
  /**
   * @deprecated `fbc` / `fbp` / `rdt_uuid` were renamed to `_fbc` / `_fbp` / `_rdt_uuid` in 9.0.0.
   * Accepted so that conversions from clients still on an older SDK keep their match keys; the
   * senders read them only as a fallback (`server/click-ids.ts`). Remove once those clients are
   * gone.
   */
  // oxlint-disable-next-line typescript/no-deprecated -- Legacy pre-9.0 click-id fields must survive validation.
  fbc: optional(tagText),
  fbp: optional(tagText),
  rdt_uuid: optional(tagText),
  // Google Ads
  gclid: optional(tagText),
  gclsrc: optional(tagText),
  gad_source: optional(tagText),
  gad_campaignid: optional(tagText),
  network: optional(tagText),
  match_type: optional(tagText),
  wbraid: optional(tagText),
  gbraid: optional(tagText),
  dclid: optional(tagText),
  _gcl_aw: optional(tagText),
  _gcl_gb: optional(tagText),
  // Microsoft Ads
  msclkid: optional(tagText),
  _uetmsclkid: optional(tagText),
  // Reddit Ads
  rdt_cid: optional(tagText),
  _rdt_cid: optional(tagText),
  _rdt_uuid: optional(tagText),
  // LinkedIn Ads
  li_fat_id: optional(tagText),
  _li_fat_id: optional(tagText),
  // OpenAI Ads
  oppref: optional(tagText),
  __oppref: optional(tagText),
  __obref: optional(tagText),
  // other click ids
  ko_click_id: optional(tagText),
  ScCid: optional(tagText),
  ttclid: optional(tagText),
  twclid: optional(tagText),
  yclid: optional(tagText),
  epik: optional(tagText),
  // utm params
  utm_source: optional(tagText),
  utm_medium: optional(tagText),
  utm_campaign: optional(tagText),
  utm_term: optional(tagText),
  utm_content: optional(tagText),
  utm_id: optional(tagText),
  utm_source_platform: optional(tagText),
  utm_creative_format: optional(tagText),
  utm_marketing_tactic: optional(tagText),
});

export const propertiesSchema = optional(
  pipe(
    record(string(), union([propertyText, number(), boolean(), _null(), items])),
    transform(takeProperties)
  )
);

/**
 * How far an event's time may be from the server's before the client clock it was stamped with is
 * taken as wrong. A batch legitimately arrives late — a tab frozen in the background, a
 * session_start held back after a failed batch — by hours, not days; a phone set to another year
 * writes its sessions into that year.
 */
const MAX_CLOCK_SKEW = 24 * 60 * 60 * 1000;

/**
 * Puts the events stamped by a wrong client clock onto the server's, where they are parsed. Only
 * the events outside `MAX_CLOCK_SKEW` move, so one bad event cannot drag the rest of its batch
 * along: they move together by their own latest one — the wrong clock at sending — keeping their
 * order and spacing, and one still out after that (a batch mixing two wrong clocks) is on no clock
 * at all and takes the server's time. Corrected rather than rejected, for the same reason values
 * are truncated: a wrong clock should cost the event its time, not the batch its events.
 */
function alignClock<T extends { timestamp: string }>(events: T[], now = Date.now()): T[] {
  const within = (time: number) => Math.abs(now - time) <= MAX_CLOCK_SKEW;
  const times = events.map((event) => Date.parse(event.timestamp));
  const wrong = times.filter((time) => !within(time));
  if (wrong.length === 0) return events;
  const offset = now - Math.max(...wrong);
  return events.map((event, i) => {
    if (within(times[i])) return event;
    const shifted = times[i] + offset;
    return { ...event, timestamp: new Date(within(shifted) ? shifted : now).toISOString() };
  });
}

export const createTrackEventSchema = pipe(
  array(
    object({
      /**
       * The event's id, generated by the client when the event was tracked (12.1) and given to
       * the browser pixels as their deduplication id. Store the event under it with
       * `on conflict (id) do nothing`: a batch retried after the server committed it then
       * stores nothing twice. Optional for clients before 12.1, which send none — generate one
       * on the server for those.
       */
      id: optional(uuid({ version: 'v7' })),
      name: string().check(trim(), minLength(1), maxLength(64)),
      // Generated by the SDK, like `id` (`visitorId()`, `Session`): uuidv7 as well, so the
      // constraint is checked here once and the server need not check it again.
      visitor_id: uuid({ version: 'v7' }),
      session_id: uuid({ version: 'v7' }),
      platform: _enum(ALL_PLATFORMS),
      environment: _enum(ALL_ENVIRONMENTS),
      timestamp: iso.datetime(),
      tags: tagsSchema,
      properties: propertiesSchema,
    })
  ).check(minLength(1), maxLength(100)),
  transform((events) => alignClock(events))
);

/**
 * `POST /visitors`, what clients before 11.0 create their visitor with; 11.0 generates the id
 * itself and the server creates the visitor from its first events (README, "Visitors").
 * Kept for servers that still serve older clients.
 */
export const createVisitorSchema = object({
  device_id: string().check(trim(), minLength(1), maxLength(36)),
  platform: _enum(ALL_PLATFORMS),
  environment: _enum(ALL_ENVIRONMENTS),
  tags: tagsSchema,
});

const emailValue = pipe(string().check(trim(), toLowerCase(), maxLength(320)), email());

/** E.164: a plus sign (+) prefix, country code, then digits only, no dashes/parens/spaces. */
const phoneValue = pipe(string().check(trim()), e164());

const addressValue = object({
  first_name: optional(string().check(trim(), maxLength(128))),
  last_name: optional(string().check(trim(), maxLength(128))),
  street: optional(string().check(trim(), maxLength(256))),
  city: optional(string().check(trim(), maxLength(128))),
  /** User province, state, or region. Example: `Hampshire` */
  region: optional(string().check(trim(), maxLength(128))),
  postal_code: optional(string().check(trim(), maxLength(32))),
  /** 2-letter country code, per the ISO 3166-1 alpha-2 standard. Example: `UK` */
  country: optional(string().check(trim(), toUpperCase(), regex(/^[A-Z]{2}$/))),
});

/**
 * User-provided data (UPD) used for enhanced conversions, Customer Match, and demographics.
 * Values are sent unhashed; Google normalizes and hashes them before they reach its servers.
 *
 * Multiple values may be sent to increase the match rate: up to 3 emails, 3 phone numbers, and
 * 2 addresses.
 *
 * @see https://support.google.com/analytics/answer/14078702
 * @see https://support.google.com/google-ads/answer/13258081
 */
export const userProvidedDataSchema = object({
  email: optional(union([emailValue, array(emailValue).check(minLength(1), maxLength(3))])),
  phone_number: optional(union([phoneValue, array(phoneValue).check(minLength(1), maxLength(3))])),
  address: optional(union([addressValue, array(addressValue).check(minLength(1), maxLength(2))])),
});

export const updateVisitorSchema = object({
  user_id: optional(uuid()),
  user_data: optional(userProvidedDataSchema),
  /**
   * Sent by clients before 11.1, which PATCHed their tags on every page load. From 11.1 the
   * server refreshes `visitor.tags` from each `session_start` — the moment the visit arrives —
   * and `identify` sends none: at sign-in the page is no longer where the visit came in.
   */
  tags: optional(tagsSchema),
});

export const createFeedbackSchema = object({
  name: string().check(minLength(1), maxLength(256)),
  // Trimmed and lower-cased like every other email the SDK accepts, so a host stores the
  // normalized form without wrapping the schema.
  email: emailValue,
  message: string().check(minLength(1), maxLength(65536)),
  /**
   * The Cloudflare Turnstile token the host verifies before storing the feedback (the same field
   * `@shware/security`'s email-code request carries). Required: without it `POST /feedback` is an
   * open free-text write that only a rate limit protects. Single-use: Turnstile spends the token
   * at verification, so the caller resets the widget after every submit, success or failure.
   */
  turnstileToken: string().check(minLength(1), maxLength(2048)),
});

const noEmptyString = pipe(
  string().check(maxLength(256)),
  transform((v) => (v ? v : undefined))
);

/**
 * The schema for creating a link.
 * @see https://support.google.com/analytics/answer/10917952
 * */
export const createLinkSchema = object({
  /** The URL that the user is redirected to. */
  url: url().check(minLength(1), maxLength(1024)), // required

  /**
   * Campaign ID. Used to identify a specific campaign or promotion. This is a required key for GA4
   * data import. Use the same IDs that you use when uploading campaign cost data.
   */
  utm_id: optional(noEmptyString),

  /** Referrer, for example: google, newsletter4, billboard */
  utm_source: string().check(minLength(1), maxLength(256)), // required

  /** Marketing medium, for example: cpc, banner, email */
  utm_medium: string().check(minLength(1), maxLength(256)), // required

  /** Product, slogan, promo code, for example, spring_sale */
  utm_campaign: string().check(minLength(1), maxLength(256)), // required

  /** Paid keyword */
  utm_term: optional(noEmptyString),

  /**
   * Use to differentiate creatives. For example, if you have two call-to-action links within the
   * same email message, you can use utm_content and set different values for each so you can tell
   * which version is more effective.
   */
  utm_content: optional(noEmptyString),

  /**
   * The platform responsible for directing traffic to a given Analytics property (such as a buying
   * platform that sets budgets and targeting criteria or a platform that manages organic traffic
   * data). For example, Search Ads 360 or Display & Video 360.
   */
  utm_source_platform: optional(noEmptyString),

  /**
   * Type of creative, for example, display, native, video, search, utm_creative_format is not
   * currently reported in Google Analytics 4 properties.
   */
  utm_creative_format: optional(noEmptyString),

  /**
   * Targeting criteria applied to a campaign, for example, remarketing, prospecting,
   * utm_marketing_tactic is not currently reported in Google Analytics 4 properties.
   * */
  utm_marketing_tactic: optional(noEmptyString),
});

export type CreateTrackEventDTO = z.output<typeof createTrackEventSchema>;
export type CreateFeedbackDTO = z.output<typeof createFeedbackSchema>;
export type CreateLinkDTO = z.output<typeof createLinkSchema>;
export type CreateVisitorDTO = z.output<typeof createVisitorSchema>;
export type UserProvidedDataDTO = z.output<typeof userProvidedDataSchema>;
export type UpdateVisitorDTO = z.output<typeof updateVisitorSchema>;
