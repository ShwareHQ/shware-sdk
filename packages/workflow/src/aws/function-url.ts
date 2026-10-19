/**
 * Lambda Function URL events (payload format 2.0) as fetch `Request`s, and `Response`s back as
 * the result Lambda turns into the HTTP response — so the host's HTTP API runs unchanged.
 */

export interface FunctionUrlEvent {
  version?: string;
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    domainName?: string;
    http: { method: string; sourceIp?: string; userAgent?: string };
  };
}

export interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
}

/**
 * An HTTP request, told apart by the event's own top-level shape — the Function URL wraps
 * every request in `requestContext.http`, so no request body can pass for anything else.
 */
export function isFunctionUrlEvent(event: unknown): event is FunctionUrlEvent {
  if (typeof event !== 'object' || event === null) return false;
  // Untrusted until checked: every level may be missing
  const { requestContext, rawPath } = event as {
    requestContext?: { http?: { method?: unknown } | null } | null;
    rawPath?: unknown;
  };
  return (
    typeof rawPath === 'string' &&
    typeof requestContext === 'object' &&
    requestContext !== null &&
    typeof requestContext.http === 'object' &&
    requestContext.http !== null &&
    typeof requestContext.http.method === 'string'
  );
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function toRequest(event: FunctionUrlEvent): Request {
  const method = event.requestContext.http.method.toUpperCase();
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  if (event.cookies !== undefined && event.cookies.length > 0) {
    headers.set('cookie', event.cookies.join('; '));
  }
  const host = event.requestContext.domainName ?? headers.get('host') ?? 'localhost';
  const query =
    event.rawQueryString === undefined || event.rawQueryString === ''
      ? ''
      : `?${event.rawQueryString}`;
  const hasBody = method !== 'GET' && method !== 'HEAD' && event.body !== undefined;
  return new Request(`https://${host}${event.rawPath}${query}`, {
    method,
    headers,
    ...(hasBody
      ? { body: event.isBase64Encoded === true ? fromBase64(event.body ?? '') : event.body }
      : {}),
  });
}

/** Content types sent as text; everything else (a tracking pixel) goes back base64. */
const TEXTUAL =
  /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg\+xml)/i;

export async function fromResponse(response: Response, method: string): Promise<FunctionUrlResult> {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  response.headers.forEach((value, name) => {
    if (name === 'set-cookie') cookies.push(value);
    else headers[name] = value;
  });
  const contentType = response.headers.get('content-type') ?? '';
  const head = method.toUpperCase() === 'HEAD';
  const bytes = head ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
  const textual = bytes.length === 0 || TEXTUAL.test(contentType);
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length === 0 ? {} : { cookies }),
    body: textual ? new TextDecoder().decode(bytes) : toBase64(bytes),
    isBase64Encoded: !textual,
  };
}
