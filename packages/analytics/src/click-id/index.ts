import { type SetCookie, parseCookie, stringifySetCookie } from 'cookie';

/**
 * Server-side resolution of ad-click-id cookies (`_fbc`, `_rdt_cid`) from the incoming request.
 *
 * This is the framework-agnostic core meant to run on the *document* response (e.g. TanStack Start
 * server middleware, Next middleware). Setting `_fbc` via an HTTP `Set-Cookie` header on the top
 * document — rather than `document.cookie` on the client — is what Meta officially recommends and is
 * the only reliable way to keep the cookie alive for 90 days in Safari: ITP caps JavaScript-set
 * cookies on an fbclid-decorated landing page to 24 hours, and the document response is never
 * classified as CNAME/IP cloaking (it is the reference the browser measures cloaking against).
 *
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 */

// Meta drops fbc values whose click happened more than 90 days ago.
const FBC_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RDT_CID_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Tolerate a little clock skew when validating a creationTime against "now".
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export const FBC_COOKIE = '_fbc';
export const RDT_CID_COOKIE = '_rdt_cid';

export type ParsedFbc = { raw: string; creationTime: number; fbclid: string };

/**
 * Parse `fb.<subdomainIndex>.<creationTime>.<fbclid>`.
 * Returns undefined for anything malformed — an fbclid never contains a dot, but joining the tail
 * back together keeps us forward-compatible if that ever changes.
 */
export function parseFbc(
  raw: string | undefined | null,
  now: number = Date.now()
): ParsedFbc | undefined {
  if (!raw) return undefined;
  const parts = raw.split('.');
  if (parts.length < 4 || parts[0] !== 'fb') return undefined;

  const creationTime = Number(parts[2]);
  const fbclid = parts.slice(3).join('.');
  if (!fbclid) return undefined;
  // creationTime is UNIX ms; reject seconds-precision or future-dated values as malformed.
  if (!Number.isFinite(creationTime)) return undefined;
  if (creationTime < 1e12 || creationTime > now + CLOCK_SKEW_MS) return undefined;

  return { raw, creationTime, fbclid };
}

/**
 * Build a fresh `_fbc` value. subdomainIndex is the cookie's domain level (com=0, example.com=1,
 * www.example.com=2); 1 is correct for an apex-hosted cookie.
 */
export function formatFbc(fbclid: string, now: number, subdomainIndex = 1): string {
  return `fb.${subdomainIndex}.${now}.${fbclid}`;
}

export type ResolveClickIdCookiesInput = {
  /** The absolute request URL (must include the query string). */
  url: string;
  /** The raw `Cookie` request header, if any. */
  cookieHeader?: string | null;
  /** Overridable clock, primarily for tests. Defaults to `Date.now()`. */
  now?: number;
  /** `Domain` attribute for the emitted cookies, e.g. `.edensign.io`. Omit for a host-only cookie. */
  domain?: string;
  /** `Secure` attribute, default true. Set false only for local http testing. */
  secure?: boolean;
  /** subdomainIndex for a freshly built `_fbc` (see {@link formatFbc}). Default 1. */
  subdomainIndex?: number;
  /**
   * Re-issue a still-valid `_fbc` at its *remaining* lifetime on every call. Off by default, which
   * matches Meta's documented rule ("only set the cookie if it doesn't exist or the fbclid
   * changed") and the common open-source implementations — a same-fbclid cookie is left untouched.
   *
   * Turn it on as a best-effort ITP self-heal: if the Meta Pixel overwrote `_fbc` via
   * `document.cookie` (and Safari capped it to 24h), re-issuing the long-lived HTTP cookie on the
   * next navigation restores it. The value is byte-for-byte identical and the window never slides,
   * so it cannot trigger Meta's expired/modified warnings — but its efficacy against Safari's caps
   * is unverified, and it attaches a per-user `Set-Cookie` (forcing `no-store`) to every response,
   * which defeats CDN caching of those pages.
   */
  refresh?: boolean;
};

export type ResolveClickIdCookiesResult = {
  /**
   * Cookies to emit on the response, ready for `Set-Cookie`. Empty when nothing needs to change.
   * A `value: ''`, `maxAge: 0` entry is a deletion (an expired or malformed leftover).
   */
  cookies: SetCookie[];
  /** The resolved `_fbc` value, for immediate server-side use (e.g. Conversions API). */
  fbc?: string;
  /** The resolved `_rdt_cid` value. */
  rdt_cid?: string;
};

function searchParams(url: string): URLSearchParams {
  try {
    return new URL(url).searchParams;
  } catch {
    // Fall back to a manual split so a relative or slightly malformed URL still yields the query.
    const q = url.indexOf('?');
    return new URLSearchParams(q >= 0 ? url.slice(q + 1) : '');
  }
}

/**
 * Resolve the click-id cookies to set on the current document response.
 *
 * `_fbc` follows Meta's documented conditional-write rule: a new fbclid (or an absent cookie) opens
 * a fresh 90-day window; a same-fbclid cookie is left untouched, preserving its original
 * `creationTime`. Expired (>90d) or malformed values are cleared instead of forwarded. A still-valid
 * cookie is only re-issued when {@link ResolveClickIdCookiesInput.refresh} is on, and then at its
 * *remaining* lifetime — never `now + 90d` — so a returning visitor's window cannot slide forward
 * (which is what makes Meta flag an expired fbclid).
 */
export function resolveClickIdCookies(
  input: ResolveClickIdCookiesInput
): ResolveClickIdCookiesResult {
  const { url, cookieHeader, domain, secure = true, subdomainIndex = 1, refresh = false } = input;
  const now = input.now ?? Date.now();

  const params = searchParams(url);
  const jar = parseCookie(cookieHeader ?? '');
  const cookies: SetCookie[] = [];
  const result: ResolveClickIdCookiesResult = { cookies };

  const base = { path: '/', secure, sameSite: 'lax', domain } as const;
  const set = (name: string, value: string, ttlMs: number) =>
    cookies.push({ name, value, maxAge: Math.floor(ttlMs / 1000), ...base });
  const del = (name: string) => cookies.push({ name, value: '', maxAge: 0, ...base });

  // --- Meta _fbc ---
  const urlFbclid = params.get('fbclid') || undefined;
  const existingFbc = parseFbc(jar[FBC_COOKIE], now);

  if (urlFbclid && urlFbclid !== existingFbc?.fbclid) {
    // A new click always wins and opens a fresh 90-day window.
    const raw = formatFbc(urlFbclid, now, subdomainIndex);
    set(FBC_COOKIE, raw, FBC_TTL_MS);
    result.fbc = raw;
  } else if (existingFbc) {
    const remainingMs = existingFbc.creationTime + FBC_TTL_MS - now;
    if (remainingMs <= 0) {
      del(FBC_COOKIE);
    } else {
      // Same fbclid: leave the cookie untouched (Meta's rule), only expose the value for CAPI. The
      // opt-in refresh re-issues it at its remaining lifetime as a best-effort ITP self-heal.
      result.fbc = existingFbc.raw;
      if (refresh) set(FBC_COOKIE, existingFbc.raw, remainingMs);
    }
  } else if (jar[FBC_COOKIE]) {
    // Malformed leftover — clear it rather than forwarding it to Meta.
    del(FBC_COOKIE);
  }

  // --- Reddit _rdt_cid ---
  // No embedded timestamp, so it can only be anchored at first capture; set it once from the URL and
  // otherwise leave the existing cookie untouched (re-issuing would slide its window).
  const urlRdtCid = params.get('rdt_cid') || undefined;
  const existingRdtCid = jar[RDT_CID_COOKIE] || undefined;
  if (urlRdtCid && urlRdtCid !== existingRdtCid) {
    set(RDT_CID_COOKIE, urlRdtCid, RDT_CID_TTL_MS);
    result.rdt_cid = urlRdtCid;
  } else if (existingRdtCid) {
    result.rdt_cid = existingRdtCid;
  }

  return result;
}

/** Serialize the resolved cookies into `Set-Cookie` header values. */
export function toSetCookieHeaders(cookies: SetCookie[]): string[] {
  return cookies.map((cookie) => stringifySetCookie(cookie));
}
