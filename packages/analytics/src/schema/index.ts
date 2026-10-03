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
  os: optional(string()),
  os_name: optional(string()),
  os_version: optional(string()),
  browser: optional(string()),
  browser_name: optional(string()),
  browser_version: optional(string()),
  device: optional(string()),
  device_id: optional(string().check(trim(), minLength(1), maxLength(36))),
  device_type: optional(string()),
  device_vendor: optional(string()),
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
  release: optional(string()),
  language: optional(string()),
  time_zone: optional(string()),
  page_location: optional(string()),
  page_referrer: optional(string()),
  page_title: optional(string()),
  page_load_id: optional(string()),
  /**
   * @deprecated Renamed to `page_location` in 7.0.0. Accepted so that events from clients
   * still on an older SDK are not stripped of their page URL at this boundary — a browser
   * bundle stays cached long after a backend deploys. Remove once those clients are gone;
   * `pageLocation` in `server/page-location.ts` is the only reader.
   */
  source_url: optional(string()),
  // app info
  advertising_id: optional(string()),
  install_referrer: optional(string()),
  // Ad click ids (URL parameters) and ad platform cookies (underscore names); see AdvertisingInfo.
  // Meta Ads
  fbclid: optional(string()),
  ad_id: optional(string()),
  ad_name: optional(string()),
  adset_id: optional(string()),
  adset_name: optional(string()),
  campaign_id: optional(string()),
  campaign_name: optional(string()),
  placement: optional(string()),
  _fbc: optional(string()),
  _fbp: optional(string()),
  /**
   * @deprecated `fbc` / `fbp` / `rdt_uuid` were renamed to `_fbc` / `_fbp` / `_rdt_uuid` in 9.0.0.
   * Accepted so that conversions from clients still on an older SDK keep their match keys; the
   * senders read them only as a fallback (`server/click-ids.ts`). Remove once those clients are
   * gone.
   */
  fbc: optional(string()),
  fbp: optional(string()),
  rdt_uuid: optional(string()),
  // Google Ads
  gclid: optional(string()),
  gclsrc: optional(string()),
  gad_source: optional(string()),
  gad_campaignid: optional(string()),
  wbraid: optional(string()),
  gbraid: optional(string()),
  dclid: optional(string()),
  _gcl_aw: optional(string()),
  _gcl_gb: optional(string()),
  // Microsoft Ads
  msclkid: optional(string()),
  _uetmsclkid: optional(string()),
  // Reddit Ads
  rdt_cid: optional(string()),
  _rdt_cid: optional(string()),
  _rdt_uuid: optional(string()),
  // LinkedIn Ads
  li_fat_id: optional(string()),
  _li_fat_id: optional(string()),
  // OpenAI Ads
  oppref: optional(string()),
  __oppref: optional(string()),
  __obref: optional(string()),
  // other click ids
  ko_click_id: optional(string()),
  ScCid: optional(string()),
  ttclid: optional(string()),
  twclid: optional(string()),
  yclid: optional(string()),
  epik: optional(string()),
  // utm params
  utm_source: optional(string()),
  utm_medium: optional(string()),
  utm_campaign: optional(string()),
  utm_term: optional(string()),
  utm_content: optional(string()),
  utm_id: optional(string()),
  utm_source_platform: optional(string()),
  utm_creative_format: optional(string()),
  utm_marketing_tactic: optional(string()),
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
      name: string().check(trim(), minLength(1), maxLength(64)),
      visitor_id: uuid(),
      session_id: uuid(),
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
   * and `setVisitor` sends none: at sign-in the page is no longer where the visit came in.
   */
  tags: optional(tagsSchema),
});

export const createFeedbackSchema = object({
  name: string().check(minLength(1), maxLength(256)),
  email: email().check(maxLength(320)),
  message: string().check(minLength(1), maxLength(65536)),
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
