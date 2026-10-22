import { Buffer } from 'node:buffer';
/**
 * AWS Signature Version 4 over WebCrypto, which a Worker and Node both have: enough to sign
 * the JSON API calls the transports make. Headers are signed as given (plus `host` and
 * `x-amz-date`); the payload hash is the body's SHA-256.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface SigV4Request {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  credentials: SigV4Credentials;
  region: string;
  service: string;
  /** `YYYYMMDD'T'HHMMSS'Z'`; now by default. */
  datetime?: string;
}

const utf8 = new TextEncoder();

const hex = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString('hex');

async function sha256(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', utf8.encode(data)));
}

async function hmac(
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  data: string
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', imported, utf8.encode(data));
}

/** RFC 3986 encoding, as SigV4 wants it: only unreserved characters stay. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Each path segment encoded once (the URL already decoded it). SigV4 asks non-S3 services to
 * encode the path twice; for the fixed, plain paths signed here (SES's
 * `/v2/email/outbound-emails`) the two agree. A path with reserved characters would need the
 * second pass before this signer could be used for it.
 */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encode(decodeURIComponent(segment)))
    .join('/');
}

/**
 * The query as sent, each name and value re-encoded. Parsed by hand: URLSearchParams reads `+`
 * as a space, which would sign a value other than the one on the wire.
 */
function canonicalQuery(search: string): string {
  if (search === '' || search === '?') return '';
  return search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=');
      const name = at === -1 ? pair : pair.slice(0, at);
      const value = at === -1 ? '' : pair.slice(at + 1);
      return [encode(decodeURIComponent(name)), encode(decodeURIComponent(value))] as const;
    })
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** The request's headers with `authorization` (and `x-amz-date`, the session token) added. */
export async function signRequest(request: SigV4Request): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const datetime = request.datetime ?? new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.slice(0, 8);
  const { accessKeyId, secretAccessKey, sessionToken } = request.credentials;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers.host = url.host;
  headers['x-amz-date'] = datetime;
  if (sessionToken !== undefined) headers['x-amz-security-token'] = sessionToken;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.search),
    ...names.map((name) => `${name}:${headers[name]}`),
    '',
    signedHeaders,
    await sha256(request.body ?? ''),
  ].join('\n');

  const scope = `${date}/${request.region}/${request.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, await sha256(canonical)].join('\n');

  let key = await hmac(utf8.encode(`AWS4${secretAccessKey}`), date);
  for (const part of [request.region, request.service, 'aws4_request']) {
    key = await hmac(key, part);
  }
  const signature = hex(await hmac(key, toSign));

  const { host: _host, ...sent } = headers;
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
