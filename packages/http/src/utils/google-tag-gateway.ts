import { getGeolocation } from './geolocation';

/**
 * In a browser, verify the setup by navigating to: https://example.com/metrics/healthy. The page
 * should read ok. Verify that geographical information is being included by navigating to:
 * https://example.com/metrics/?validate_geo=healthy. The page should read ok.
 */
export async function forwardToGoogleTagGateway(request: Request, gaId: string) {
  const GATEWAY_HOST = `${gaId}.fps.goog`;
  const { pathname, search } = new URL(request.url);

  const target = `https://${GATEWAY_HOST}${pathname}${search}`;

  const headers = new Headers();

  // Forward the browser-identifying headers a load balancer would pass through:
  // cookies for first-party measurement, user-agent + client hints so GA doesn't
  // classify hits as bot traffic and the gateway can serve UA-appropriate scripts.
  for (const [name, value] of request.headers) {
    if (
      name === 'cookie' ||
      name === 'user-agent' ||
      name === 'accept-language' ||
      name === 'referer' ||
      name === 'x-forwarded-for' ||
      name.startsWith('sec-ch-')
    ) {
      headers.set(name, value);
    }
  }

  // Convert geo headers to Google Tag Gateway format
  // https://developers.google.com/tag-platform/tag-manager/gateway/setup-guide
  const { country, region, city, latitude, longitude, ip_address } = getGeolocation(request);

  // A CDN in front (Vercel/Cloudflare/CloudFront) normally sets x-forwarded-for already;
  // fall back to the platform-specific client-IP header if it was stripped.
  if (ip_address && !headers.has('x-forwarded-for')) {
    headers.set('x-forwarded-for', ip_address);
  }

  if (country && region) {
    headers.set('x-forwarded-countryregion', `${country}-${region}`);
  } else if (country) {
    headers.set('x-forwarded-country', country);
  }

  // City-level geolocation, format per the official Fastly/Google Cloud configs:
  // latlong=<lat>,<lng>;city=<city>
  const geolocation = [
    latitude !== undefined && longitude !== undefined && `latlong=${latitude},${longitude}`,
    city && `city=${city}`,
  ].filter(Boolean);

  if (geolocation.length > 0) {
    headers.set('x-forwarded-geolocation', geolocation.join(';'));
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // The conversion endpoint (g/measurement/conversion) answers POSTs with a 302 to
  // www.google.com. Pass that redirect through to the browser instead of following it
  // here: the hop only carries signal when the browser makes it with its own google.com
  // cookies (Google Signals / cross-domain conversion linking). Not following redirects
  // also means the one-shot body stream never needs to be replayed, so it can be
  // forwarded as-is.
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    // Opt out of Next.js fetch caching (the official CloudFront config likewise
    // requires CachingDisabled): measurement hits must never be served from cache.
    cache: 'no-store',
    ...(hasBody && { duplex: 'half' as const }),
  });

  // Strip content-encoding/content-length because fetch() auto-decompresses
  // but keeps the original headers, causing ERR_CONTENT_DECODING_FAILED
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(response.body, { status: response.status, headers: responseHeaders });
}
