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
  headers.set('host', GATEWAY_HOST);

  // Forward cookies
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  // Convert Vercel geo headers to Google Tag Gateway format
  // https://developers.google.com/tag-platform/tag-manager/gateway/setup-guide
  const { country, region } = getGeolocation(request);

  if (country && region) {
    headers.set('x-forwarded-countryregion', `${country}-${region}`);
  } else if (country) {
    headers.set('x-forwarded-country', country);
  } else if (region) {
    headers.set('x-forwarded-region', region);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // Buffer the body instead of streaming it. The conversion endpoint
  // (g/measurement/conversion) answers POSTs with a 302 to www.google.com, and we want
  // to follow that hop on the server so the browser never sees a Google domain (the whole
  // point of the first-party gateway). Following a redirect requires re-issuing the
  // request, which undici cannot do with a one-shot `request.body` stream — it throws
  // "fetch failed", surfacing as a 500. A buffered body is replayable, so the redirect
  // is followed transparently here.
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
  });

  // Strip content-encoding/content-length because fetch() auto-decompresses
  // but keeps the original headers, causing ERR_CONTENT_DECODING_FAILED
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(response.body, { status: response.status, headers: responseHeaders });
}
