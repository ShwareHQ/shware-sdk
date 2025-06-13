import {
  z,
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
} from 'zod/v4-mini';

const items = array(
  record(
    string().check(trim(), minLength(1), maxLength(128)),
    union([string().check(maxLength(512)), number(), boolean(), _null()])
  )
);

export const createTrackEventSchema = array(
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
  properties: record(
    string().check(trim(), minLength(1), maxLength(128)),
    union([string().check(maxLength(512)), number(), boolean(), _null()])
  ).check(refine((data) => Object.keys(data).length <= 64)),
});
