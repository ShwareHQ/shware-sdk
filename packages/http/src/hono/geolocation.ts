import type { Context } from 'hono';

export type Geolocation = {
  ip?: string;
  city?: string;
  country?: string;
  continent?: string;
  longitude?: number;
  latitude?: number;
  region?: string;
  region_code?: string;
  metro_code?: string;
  postal_code?: string;
  timezone?: string;
};

/** reference: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers */
export function geolocation(c: Context): Geolocation {
  return {
    ip: c.req.header('true-client-ip') ?? c.req.header('cf-connecting-ip'),
    city: c.req.header('cf-ipcity'),
    country: c.req.header('cf-ipcountry'),
    continent: c.req.header('cf-ipcontinent'),
    longitude: c.req.header('cf-iplongitude') ? Number(c.req.header('cf-iplongitude')) : undefined,
    latitude: c.req.header('cf-iplatitude') ? Number(c.req.header('cf-iplatitude')) : undefined,
    region: c.req.header('cf-region'),
    region_code: c.req.header('cf-region-code'),
    metro_code: c.req.header('cf-metro-code'),
    postal_code: c.req.header('cf-postal-code'),
    timezone: c.req.header('cf-timezone'),
  };
}

/** https://github.com/vercel/vercel/blob/main/packages/functions/src/headers.ts */
export function geolocationVercel(c: Context): Geolocation {
  return {
    ip: c.req.header('x-real-ip'),
    city: c.req.header('x-vercel-ip-city'),
    country: c.req.header('x-vercel-ip-country'),
    continent: c.req.header('x-vercel-ip-continent'),
    longitude: c.req.header('x-vercel-ip-longitude')
      ? Number(c.req.header('x-vercel-ip-longitude'))
      : undefined,
    latitude: c.req.header('x-vercel-ip-latitude')
      ? Number(c.req.header('x-vercel-ip-latitude'))
      : undefined,
    region_code: c.req.header('x-vercel-ip-country-region'),
    postal_code: c.req.header('x-vercel-ip-postal-code'),
  };
}
