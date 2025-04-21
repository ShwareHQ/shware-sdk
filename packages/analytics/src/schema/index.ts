import { z } from 'zod';

const items = z.array(
  z.record(
    z.string().trim().min(1).max(128),
    z.union([z.string().max(512), z.number(), z.boolean(), z.null()])
  )
);

export const createTrackEventSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    visitor_id: z.coerce.bigint(),
    timestamp: z.string().datetime(),
    tags: z.object({
      os: z.string().optional(),
      os_name: z.string().optional(),
      os_version: z.string().optional(),
      browser: z.string().optional(),
      browser_name: z.string().optional(),
      browser_version: z.string().optional(),
      platform: z
        .enum(['ios', 'android', 'web', 'macos', 'windows', 'linux', 'unknown'])
        .optional(),
      device: z.string().optional(),
      device_id: z.string().trim().min(1).max(36).optional(),
      device_type: z.string().optional(),
      device_vendor: z.string().optional(),
      device_pixel_ratio: z.string().optional(),
      screen_resolution: z
        .string()
        .regex(/^\d+x\d+$/)
        .transform((v) => v as `${number}x${number}`)
        .optional(),
      release: z.string().optional(),
      language: z.string().optional(),
      time_zone: z.string().optional(),
      environment: z.enum(['development', 'production']).optional(),
      source_url: z.string().optional(),
      source: z.enum(['web', 'app', 'offline']).optional(),
      fbc: z.string().optional(),
      fbp: z.string().optional(),
      gclid: z.string().optional(),
      advertising_id: z.string().optional(),
      utm_source: z.string().optional(),
      utm_medium: z.string().optional(),
      utm_campaign: z.string().optional(),
      utm_term: z.string().optional(),
      utm_content: z.string().optional(),
    }),
    properties: z
      .record(
        z.string().trim().min(1).max(128),
        z.union([z.string().max(512), z.number(), z.boolean(), z.null(), items])
      )
      .refine((data) => Object.keys(data).length <= 64)
      .optional(),
  })
  .array()
  .min(1)
  .max(100);

export const createVisitorSchema = z.object({
  device_id: z.string().trim().min(1).max(36),
  properties: z
    .record(
      z.string().trim().min(1).max(128),
      z.union([z.string().max(512), z.number(), z.boolean(), z.null()])
    )
    .refine((data) => Object.keys(data).length <= 64)
    .optional(),
});

export const updateVisitorSchema = z.object({
  properties: z
    .record(
      z.string().trim().min(1).max(128),
      z.union([z.string().max(512), z.number(), z.boolean(), z.null()])
    )
    .refine((data) => Object.keys(data).length <= 64),
});
