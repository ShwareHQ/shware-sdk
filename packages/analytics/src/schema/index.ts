import {
  optional,
  object,
  string,
  regex,
  number,
  boolean,
  null as _null,
  coerce,
  enum as _enum,
  trim,
  union,
  record,
  array,
  iso,
  minLength,
  maxLength,
  refine,
  pipe,
  transform,
  email,
  type z,
  uuid,
  url,
} from 'zod/mini';

const items = array(
  record(
    string().check(trim(), minLength(1), maxLength(128)),
    union([string().check(maxLength(512)), number(), boolean(), _null()])
  )
);

/** @deprecated */
export const createTrackEventSchemaV1 = array(
  object({
    name: string().check(trim(), minLength(1), maxLength(64)),
    visitor_id: coerce.bigint(),
    timestamp: iso.datetime(),
    tags: object({
      os: optional(string()),
      os_name: optional(string()),
      os_version: optional(string()),
      browser: optional(string()),
      browser_name: optional(string()),
      browser_version: optional(string()),
      platform: optional(_enum(['ios', 'android', 'web', 'macos', 'windows', 'linux', 'unknown'])),
      device: optional(string()),
      device_id: optional(string().check(trim(), minLength(1), maxLength(36))),
      device_type: optional(string()),
      device_vendor: optional(string()),
      device_pixel_ratio: optional(string()),
      screen_resolution: optional(
        pipe(
          string().check(regex(/^\d+x\d+$/)),
          transform((v) => v as `${number}x${number}`)
        )
      ),
      release: optional(string()),
      language: optional(string()),
      time_zone: optional(string()),
      environment: optional(_enum(['development', 'production'])),
      source_url: optional(string()),
      source: optional(_enum(['web', 'app', 'offline'])),
      fbc: optional(string()),
      fbp: optional(string()),
      gclid: optional(string()),
      advertising_id: optional(string()),
      utm_source: optional(string()),
      utm_medium: optional(string()),
      utm_campaign: optional(string()),
      utm_term: optional(string()),
      utm_content: optional(string()),
    }),
    properties: optional(
      record(
        string().check(trim(), minLength(1), maxLength(128)),
        union([string().check(maxLength(512)), number(), boolean(), _null(), items])
      ).check(refine((data) => Object.keys(data).length <= 64))
    ),
  })
).check(minLength(1), maxLength(100));

export const createTrackEventSchema = array(
  object({
    name: string().check(trim(), minLength(1), maxLength(64)),
    visitor_id: uuid(),
    timestamp: iso.datetime(),
    tags: object({
      os: optional(string()),
      os_name: optional(string()),
      os_version: optional(string()),
      browser: optional(string()),
      browser_name: optional(string()),
      browser_version: optional(string()),
      platform: optional(_enum(['ios', 'android', 'web', 'macos', 'windows', 'linux', 'unknown'])),
      device: optional(string()),
      device_id: optional(string().check(trim(), minLength(1), maxLength(36))),
      device_type: optional(string()),
      device_vendor: optional(string()),
      device_pixel_ratio: optional(string()),
      screen_resolution: optional(
        pipe(
          string().check(regex(/^\d+x\d+$/)),
          transform((v) => v as `${number}x${number}`)
        )
      ),
      release: optional(string()),
      language: optional(string()),
      time_zone: optional(string()),
      environment: optional(_enum(['development', 'production'])),
      source_url: optional(string()),
      source: optional(_enum(['web', 'app', 'offline'])),
      fbc: optional(string()),
      fbp: optional(string()),
      gclid: optional(string()),
      advertising_id: optional(string()),
      utm_source: optional(string()),
      utm_medium: optional(string()),
      utm_campaign: optional(string()),
      utm_term: optional(string()),
      utm_content: optional(string()),
    }),
    properties: optional(
      record(
        string().check(trim(), minLength(1), maxLength(128)),
        union([string().check(maxLength(512)), number(), boolean(), _null(), items])
      ).check(refine((data) => Object.keys(data).length <= 64))
    ),
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
  utm_id: optional(string().check(maxLength(256))),

  /** Referrer, for example: google, newsletter4, billboard */
  utm_source: string().check(minLength(1), maxLength(256)), // required

  /** Marketing medium, for example: cpc, banner, email */
  utm_medium: string().check(minLength(1), maxLength(256)), // required

  /** Product, slogan, promo code, for example: spring_sale */
  utm_campaign: string().check(minLength(1), maxLength(256)), // required

  /** Paid keyword */
  utm_term: optional(string().check(maxLength(256))),

  /**
   * Use to differentiate creatives. For example, if you have two call-to-action links within the
   * same email message, you can use utm_content and set different values for each so you can tell
   * which version is more effective.
   */
  utm_content: optional(string().check(maxLength(256))),

  /**
   * The platform responsible for directing traffic to a given Analytics property (such as a buying
   * platform that sets budgets and targeting criteria or a platform that manages organic traffic
   * data). For example: Search Ads 360 or Display & Video 360.
   */
  utm_source_platform: optional(string().check(maxLength(256))),

  /**
   * Type of creative, for example: display, native, video, search, utm_creative_format is not
   * currently reported in Google Analytics 4 properties.
   */
  utm_creative_format: optional(string().check(maxLength(256))),

  /**
   * Targeting criteria applied to a campaign, for example: remarketing, prospecting,
   * utm_marketing_tactic is not currently reported in Google Analytics 4 properties.
   * */
  utm_marketing_tactic: optional(string().check(maxLength(256))),
});

export type CreateFeedbackDTO = z.output<typeof createFeedbackSchema>;
export type CreateLinkDTO = z.output<typeof createLinkSchema>;
