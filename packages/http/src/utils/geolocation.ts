import { extractIpAddress } from './ip';

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

function toNumber(value: string | null): number | undefined {
  return value ? Number(value) : undefined;
}

/** reference: https://developers.cloudflare.com/rules/transform/managed-transforms/reference/#add-visitor-location-headers */
export function getGeolocationFromCloudflare(r: Request): Geolocation {
  return {
    ip_address: r.headers.get('true-client-ip') ?? r.headers.get('cf-connecting-ip') ?? undefined,
    city: r.headers.get('cf-ipcity') ?? undefined,
    country: r.headers.get('cf-ipcountry') ?? undefined,
    continent: r.headers.get('cf-ipcontinent') ?? undefined,
    longitude: toNumber(r.headers.get('cf-iplongitude')),
    latitude: toNumber(r.headers.get('cf-iplatitude')),
    region: r.headers.get('cf-region-code') ?? undefined,
    metro_code: r.headers.get('cf-metro-code') ?? undefined,
    postal_code: r.headers.get('cf-postal-code') ?? undefined,
    time_zone: r.headers.get('cf-timezone') ?? undefined,
  };
}

/** reference: https://github.com/vercel/vercel/blob/main/packages/functions/src/headers.ts */
export function getGeolocationFromVercel(r: Request): Geolocation {
  return {
    ip_address: r.headers.get('x-real-ip') ?? undefined,
    city: r.headers.get('x-vercel-ip-city') ?? undefined,
    country: r.headers.get('x-vercel-ip-country') ?? undefined,
    continent: r.headers.get('x-vercel-ip-continent') ?? undefined,
    longitude: toNumber(r.headers.get('x-vercel-ip-longitude')),
    latitude: toNumber(r.headers.get('x-vercel-ip-latitude')),
    region: r.headers.get('x-vercel-ip-country-region') ?? undefined,
    postal_code: r.headers.get('x-vercel-ip-postal-code') ?? undefined,
  };
}

/** reference: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html#cloudfront-headers-viewer-location */
export function getGeolocationFromCloudfront(r: Request): Geolocation {
  return {
    ip_address: extractIpAddress(r.headers.get('CloudFront-Viewer-Address')) ?? undefined,
    city: r.headers.get('CloudFront-Viewer-City') ?? undefined,
    country: r.headers.get('CloudFront-Viewer-Country') ?? undefined,
    longitude: toNumber(r.headers.get('CloudFront-Viewer-Longitude')),
    latitude: toNumber(r.headers.get('CloudFront-Viewer-Latitude')),
    region: r.headers.get('CloudFront-Viewer-Country-Region') ?? undefined,
    metro_code: r.headers.get('CloudFront-Viewer-Metro-Code') ?? undefined,
    postal_code: r.headers.get('CloudFront-Viewer-Postal-Code') ?? undefined,
    time_zone: r.headers.get('CloudFront-Viewer-Time-Zone') ?? undefined,
  };
}

export function getGeolocation(r: Request): Geolocation {
  if (r.headers.get('x-vercel-id')) return getGeolocationFromVercel(r);
  if (r.headers.get('cf-ray')) return getGeolocationFromCloudflare(r);
  return getGeolocationFromCloudfront(r);
}
