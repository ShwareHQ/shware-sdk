import {
  enum as _enum,
  null as _null,
  array,
  boolean,
  coerce,
  email,
  iso,
  maxLength,
  minLength,
  number,
  object,
  optional,
  pipe,
  record,
  refine,
  regex,
  string,
  transform,
  trim,
  union,
  url,
  uuid,
  type z,
} from 'zod/mini';

const items = array(
  record(
    string().check(trim(), minLength(1), maxLength(128)),
    union([string().check(maxLength(512)), number(), boolean(), _null()])
  )
);

export enum Platform {
  ios = 'ios',
  android = 'android',
  web = 'web',
  macos = 'macos',
  windows = 'windows',
  linux = 'linux',
  unknown = 'unknown',
}

export enum Environment {
  development = 'development',
  production = 'production',
}

export const ALL_PLATFORMS = [
  Platform.ios,
  Platform.android,
  Platform.web,
  Platform.macos,
  Platform.windows,
  Platform.linux,
  Platform.unknown,
] as const;

export const ALL_ENVIRONMENTS = [Environment.development, Environment.production] as const;

export const tagsSchema = object({
  os: optional(string()),
  os_name: optional(string()),
  os_version: optional(string()),
  browser: optional(string()),
  browser_name: optional(string()),
  browser_version: optional(string()),
  platform: _enum(Platform),
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
  release: optional(string()),
  language: optional(string()),
  time_zone: optional(string()),
  environment: _enum(Environment),
  source_url: optional(string()),
  source: optional(_enum(['web', 'app', 'offline'])),
  // app info
  advertising_id: optional(string()),
  install_referrer: optional(string()),
  // meta ads
  fbc: optional(string()),
  fbp: optional(string()),
  fbclid: optional(string()),
  ad_id: optional(string()),
  ad_name: optional(string()),
  adset_id: optional(string()),
  adset_name: optional(string()),
  campaign_id: optional(string()),
  campaign_name: optional(string()),
  placement: optional(string()),
  site_source_name: optional(string()),
  // google ads
  gclid: optional(string()),
  gclsrc: optional(string()),
  gad_source: optional(string()),
  gad_campaignid: optional(string()),
  // reddit ads
  rdt_cid: optional(string()),
  rdt_uuid: optional(string()),
  // click ids
  dclid: optional(string()),
  ko_click_id: optional(string()),
  li_fat_id: optional(string()),
  msclkid: optional(string()),
  sccid: optional(string()),
  ttclid: optional(string()),
  twclid: optional(string()),
  wbraid: optional(string()),
  yclid: optional(string()),
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
  record(
    string().check(trim(), minLength(1), maxLength(128)),
    union([string().check(maxLength(512)), number(), boolean(), _null(), items])
  ).check(refine((data) => Object.keys(data).length <= 64))
);

/** @deprecated */
export const createTrackEventSchemaV1 = array(
  object({
    name: string().check(trim(), minLength(1), maxLength(64)),
    visitor_id: coerce.bigint(),
    session_id: uuid(),
    timestamp: iso.datetime(),
    tags: tagsSchema,
    properties: propertiesSchema,
  })
).check(minLength(1), maxLength(100));

export const createTrackEventSchema = array(
  object({
    name: string().check(trim(), minLength(1), maxLength(64)),
    visitor_id: uuid(),
    session_id: uuid(),
    timestamp: iso.datetime(),
    tags: tagsSchema,
    properties: propertiesSchema,
  })
).check(minLength(1), maxLength(100));

export const createVisitorSchema = object({
  device_id: string().check(trim(), minLength(1), maxLength(36)),
  properties: optional(
    record(
      string().check(trim(), minLength(1), maxLength(128)),
      union([string().check(maxLength(512)), number(), boolean(), _null()])
    ).check(refine((data) => Object.keys(data).length <= 64))
  ),
});

export const updateVisitorSchema = object({
  user_id: optional(uuid()),
  distinct_id: optional(string().check(trim(), minLength(1), maxLength(36))),
  properties: optional(
    record(
      string().check(trim(), minLength(1), maxLength(128)),
      union([string().check(maxLength(512)), number(), boolean(), _null()])
    ).check(refine((data) => Object.keys(data).length <= 64))
  ),
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

  /** Product, slogan, promo code, for example: spring_sale */
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
   * data). For example: Search Ads 360 or Display & Video 360.
   */
  utm_source_platform: optional(noEmptyString),

  /**
   * Type of creative, for example: display, native, video, search, utm_creative_format is not
   * currently reported in Google Analytics 4 properties.
   */
  utm_creative_format: optional(noEmptyString),

  /**
   * Targeting criteria applied to a campaign, for example: remarketing, prospecting,
   * utm_marketing_tactic is not currently reported in Google Analytics 4 properties.
   * */
  utm_marketing_tactic: optional(noEmptyString),
});

export type CreateFeedbackDTO = z.output<typeof createFeedbackSchema>;
export type CreateLinkDTO = z.output<typeof createLinkSchema>;
