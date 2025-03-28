import { getRuntimeKey } from 'hono/adapter';
import type { Context } from 'hono';

export type Geolocation = {
  ip: string | null;
  city: string | null;
  country: string | null; // ISO 3166-1 alpha-2
  continent: string | null;
  longitude: number | null;
  latitude: number | null;
  region: string | null; //  ISO 3166-2
  metro_code: string | null;
  postal_code: string | null;
  timezone: string | null;
};

const runtime = getRuntimeKey();
export function geolocation(c: Context): Geolocation | null {
  /** reference: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers */
  if (runtime === 'workerd') {
    return {
      ip: c.req.header('true-client-ip') ?? c.req.header('cf-connecting-ip') ?? null,
      city: c.req.header('cf-ipcity') ?? null,
      country: c.req.header('cf-ipcountry') ?? null,
      continent: c.req.header('cf-ipcontinent') ?? null,
      longitude: c.req.header('cf-iplongitude') ? Number(c.req.header('cf-iplongitude')) : null,
      latitude: c.req.header('cf-iplatitude') ? Number(c.req.header('cf-iplatitude')) : null,
      region: c.req.header('cf-region-code') ?? null,
      metro_code: c.req.header('cf-metro-code') ?? null,
      postal_code: c.req.header('cf-postal-code') ?? null,
      timezone: c.req.header('cf-timezone') ?? null,
    };
  }

  /** https://github.com/vercel/vercel/blob/main/packages/functions/src/headers.ts */
  if (c.req.header('x-vercel-id')) {
    return {
      ip: c.req.header('x-real-ip') ?? null,
      city: c.req.header('x-vercel-ip-city') ?? null,
      country: c.req.header('x-vercel-ip-country') ?? null,
      continent: c.req.header('x-vercel-ip-continent') ?? null,
      longitude: c.req.header('x-vercel-ip-longitude')
        ? Number(c.req.header('x-vercel-ip-longitude'))
        : null,
      latitude: c.req.header('x-vercel-ip-latitude')
        ? Number(c.req.header('x-vercel-ip-latitude'))
        : null,
      region: c.req.header('x-vercel-ip-country-region') ?? null,
      metro_code: null,
      postal_code: c.req.header('x-vercel-ip-postal-code') ?? null,
      timezone: null,
    };
  }

  // cloudfront
  // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html#cloudfront-headers-viewer-location
  return {
    ip: c.req.header('CloudFront-Viewer-Address') ?? null,
    city: c.req.header('CloudFront-Viewer-City') ?? null,
    country: c.req.header('CloudFront-Viewer-Country') ?? null,
    continent: null,
    longitude: c.req.header('CloudFront-Viewer-Longitude')
      ? Number(c.req.header('CloudFront-Viewer-Longitude'))
      : null,
    latitude: c.req.header('CloudFront-Viewer-Latitude')
      ? Number(c.req.header('CloudFront-Viewer-Latitude'))
      : null,
    region: c.req.header('CloudFront-Viewer-Country-Region') ?? null,
    metro_code: c.req.header('CloudFront-Viewer-Metro-Code') ?? null,
    postal_code: c.req.header('CloudFront-Viewer-Postal-Code') ?? null,
    timezone: c.req.header('CloudFront-Viewer-Time-Zone') ?? null,
  };
}
