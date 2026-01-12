import type { Context } from 'hono';
import { getRuntimeKey } from 'hono/adapter';
import { extractIpAddress } from '../utils/ip';

export type Geolocation = {
  ip_address?: string;
  city?: string;
  country?: string; // ISO 3166-1 alpha-2
  continent?: string;
  longitude?: number;
  latitude?: number;
  region?: string; //  ISO 3166-2
  metro_code?: string;
  postal_code?: string;
  time_zone?: string;
};

/** reference: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers */
function getGeolocationFromCloudflareWorker(c: Context): Geolocation {
  return {
    ip_address: c.req.header('true-client-ip') ?? c.req.header('cf-connecting-ip'),
    city: c.req.header('cf-ipcity'),
    country: c.req.header('cf-ipcountry'),
    continent: c.req.header('cf-ipcontinent'),
    longitude: c.req.header('cf-iplongitude') ? Number(c.req.header('cf-iplongitude')) : undefined,
    latitude: c.req.header('cf-iplatitude') ? Number(c.req.header('cf-iplatitude')) : undefined,
    region: c.req.header('cf-region-code'),
    metro_code: c.req.header('cf-metro-code'),
    postal_code: c.req.header('cf-postal-code'),
    time_zone: c.req.header('cf-timezone'),
  };
}

/** https://github.com/vercel/vercel/blob/main/packages/functions/src/headers.ts */
function getGeolocationFromVercel(c: Context): Geolocation {
  return {
    ip_address: c.req.header('x-real-ip'),
    city: c.req.header('x-vercel-ip-city'),
    country: c.req.header('x-vercel-ip-country'),
    continent: c.req.header('x-vercel-ip-continent'),
    longitude: c.req.header('x-vercel-ip-longitude')
      ? Number(c.req.header('x-vercel-ip-longitude'))
      : undefined,
    latitude: c.req.header('x-vercel-ip-latitude')
      ? Number(c.req.header('x-vercel-ip-latitude'))
      : undefined,
    region: c.req.header('x-vercel-ip-country-region'),
    metro_code: undefined,
    postal_code: c.req.header('x-vercel-ip-postal-code'),
    time_zone: undefined,
  };
}

/** ref: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html#cloudfront-headers-viewer-location */
function getGeolocationFromCloudfront(c: Context): Geolocation {
  return {
    ip_address: extractIpAddress(c.req.header('CloudFront-Viewer-Address')) ?? undefined,
    city: c.req.header('CloudFront-Viewer-City'),
    country: c.req.header('CloudFront-Viewer-Country'),
    continent: undefined,
    longitude: c.req.header('CloudFront-Viewer-Longitude')
      ? Number(c.req.header('CloudFront-Viewer-Longitude'))
      : undefined,
    latitude: c.req.header('CloudFront-Viewer-Latitude')
      ? Number(c.req.header('CloudFront-Viewer-Latitude'))
      : undefined,
    region: c.req.header('CloudFront-Viewer-Country-Region'),
    metro_code: c.req.header('CloudFront-Viewer-Metro-Code'),
    postal_code: c.req.header('CloudFront-Viewer-Postal-Code'),
    time_zone: c.req.header('CloudFront-Viewer-Time-Zone'),
  };
}

export function geolocation(c: Context): Geolocation {
  if (getRuntimeKey() === 'workerd') return getGeolocationFromCloudflareWorker(c);
  if (c.req.header('x-vercel-id')) return getGeolocationFromVercel(c);
  return getGeolocationFromCloudfront(c);
}
