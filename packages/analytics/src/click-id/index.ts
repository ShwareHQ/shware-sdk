import { type SetCookie, parseCookie, stringifySetCookie } from 'cookie';

/**
 * Server-side resolution of ad-click-id cookies (`_fbc`, `_gcl_aw`/`_gcl_gb`, `_rdt_cid`,
 * `_uetmsclkid`) from the incoming request.
 *
 * This is the framework-agnostic core meant to run on the *document* response (e.g. TanStack Start
 * server middleware, Next middleware). Setting `_fbc` via an HTTP `Set-Cookie` header on the top
 * document — rather than `document.cookie` on the client — is what Meta officially recommends and is
 * the only reliable way to keep the cookie alive for 90 days in Safari: ITP caps JavaScript-set
 * cookies on a fbclid-decorated landing page to 24 hours, and the document response is never
 * classified as CNAME/IP cloaking (it is the reference the browser measures cloaking against).
 *
 * The Google pair follows the same architecture Google itself ships for server containers —
 * sGTM's Conversion Linker sets FPGCLAW via Set-Cookie for 90 days — and the sGTM ecosystem
 * productized for gtag's own cookies (stape Cookie Keeper re-issues `_gcl_*` over HTTP; vendor
 * case studies report 5–20% of Google Ads conversions recovered, up to +44% on the Safari
 * slice). One deployment caveat from WebKit's rules: the HTTP-cookie exemption holds only for
 * responses from the site's own infrastructure — a CNAME or third-party-IP host (a tagging
 * subdomain on someone else's cloud) gets its Set-Cookie silently capped to 7 days. This module
 * runs on the host's own document response, which is exactly the exempt case.
 *
 * references:
 * - https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 * - https://webkit.org/tracking-prevention/ (7d JS cookies, 24h on ad-decorated landings,
 *   CNAME/third-party-IP HTTP cookies capped to 7d, same-origin HTTP cookies exempt)
 * - https://www.simoahava.com/analytics/google-ads-server-side-tagging-google-tag-manager/
 *   (Conversion Linker → FPGCLAW via Set-Cookie, Google's own server-side equivalent)
 * - https://stape.io/helpdesk/documentation/cookie-keeper-power-up (the productized re-issue)
 */

// Meta's recommended _fbc cookie expiry. Events Manager warns ("Server sending expired fbclid")
// when the embedded creationTime is older than 90 days and match quality/attribution may degrade;
// no hard drop is documented.
const FBC_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Reddit's pixel.js rewrites `_rdt_cid` and `_rdt_uuid` for 90 days on every page load.
const RDT_CID_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RDT_UUID_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Meta's pixel rewrites `_fbp` for 90 days on every page load.
const FBP_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// OpenAI's oaiq: `__oppref` for 30 days (`720*60*60` s), `__obref` for 365 days.
const OPPREF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OBREF_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// bat.js's own expiry for _uetmsclkid (`msClkIdExpirationTime`), the Microsoft Ads click window.
const MSCLKID_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// gtag's own expiry for _gcl_* — 90 days, the length of a Google Ads click's upload window.
const GCL_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Tolerate a little clock skew when validating a creationTime against "now".
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export const FBC_COOKIE = '_fbc';
export const RDT_CID_COOKIE = '_rdt_cid';
export const GCL_AW_COOKIE = '_gcl_aw';
export const GCL_GB_COOKIE = '_gcl_gb';
export const UET_MSCLKID_COOKIE = '_uetmsclkid';
export const RDT_UUID_COOKIE = '_rdt_uuid';
export const FBP_COOKIE = '_fbp';
export const OPPREF_COOKIE = '__oppref';
export const OBREF_COOKIE = '__obref';
/** OpenAI's consent cookie; `false` is the visitor's opt-out, on which oaiq deletes its cookies. */
export const OAIQ_CONSENT_COOKIE = '__oaiq_consent';

export type ParsedFbc = { raw: string; creationTime: number; fbclid: string };

/**
 * Parse `fb.<subdomainIndex>.<creationTime>.<fbclid>[.<appendix>]`. The appendix is what Meta's
 * Parameter Builder adds to the values it writes ("an appendix field at the end of each
 * parameter"); it is not part of the click id, so `fbclid` is the fourth segment alone and the
 * value is passed on as `raw`, unchanged. Returns undefined for anything malformed.
 * ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameter-builder-library
 */
export function parseFbc(
  raw: string | undefined | null,
  now: number = Date.now()
): ParsedFbc | undefined {
  if (!raw) return undefined;
  const parts = raw.split('.');
  if (parts.length < 4 || parts.length > 5 || parts[0] !== 'fb') return undefined;
  if (parts.length === 5 && !parts[4]) return undefined;

  const creationTime = Number(parts[2]);
  const fbclid = parts[3];
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

export type ParsedGcl = { raw: string; creationTime: number; clickId: string };

/**
 * Whether a URL's `gclid` is a Google Ads click, by its `gclsrc` — gtag's own gating: absent or
 * `aw.ds` is Google Ads; `ds` / `3p.ds` are Search Ads 360's (a click on another engine, or on
 * Google with auto-tagging off), which gtag keeps in `_gcl_dc` and not `_gcl_aw`.
 * ref: https://support.google.com/sa360/answer/7342044
 */
export function isGoogleAdsGclid(gclsrc: string | null | undefined): boolean {
  return !gclsrc || gclsrc === 'aw.ds';
}

// gtag's own value validator, extracted from the live gtag.js bundle (2026-09): its parser
// accepts version "GCL" or "1", a /^\d+$/ seconds timestamp, and a click id matching this.
// Re-verify against gtag.js before changing anything here — the format is gtag's, not ours.
const GCL_CLICK_ID = /^[\w-]+$/;

/**
 * Parse a `_gcl_aw`/`_gcl_gb` value: `GCL.<seconds>.<clickId>[.<labels…>]` — note the timestamp
 * is in SECONDS, unlike `_fbc`'s milliseconds. gtag's parser accepts version `GCL` or `1` and
 * validates the segments exactly this way (`/^\d+$/` timestamp, `/^[\w-]+$/` click id); any
 * labels tail is preserved through `raw` so a re-issue stays byte-identical.
 */
export function parseGcl(
  raw: string | undefined | null,
  now: number = Date.now()
): ParsedGcl | undefined {
  if (!raw) return undefined;
  const parts = raw.split('.');
  if (parts.length < 3) return undefined;
  if (parts[0] !== 'GCL' && parts[0] !== '1') return undefined;
  const seconds = parts[1];
  const clickId = parts[2];
  if (seconds === undefined || !/^\d+$/.test(seconds)) return undefined;
  if (clickId === undefined || !GCL_CLICK_ID.test(clickId)) return undefined;
  const creationTime = Number(seconds) * 1000;
  // Reject millisecond-precision or future-dated values as malformed.
  if (creationTime >= 1e15 || creationTime > now + CLOCK_SKEW_MS) return undefined;
  return { raw, creationTime, clickId };
}

/** Build a fresh `_gcl_aw`/`_gcl_gb` value in gtag's own format. */
export function formatGcl(clickId: string, now: number): string {
  return `GCL.${Math.floor(now / 1000)}.${clickId}`;
}

// bat.js writes the click id as `_uet<msclkid>` and reads it back only when what follows the
// prefix is at most 32 characters (`msClkIdCookieValuePrefix`, `lengthMsClkId`); a msclkid is a
// 32-hex-digit UUID without dashes. Re-verify against bat.js before changing anything here —
// the format is UET's, not ours.
const UET_MSCLKID_PREFIX = '_uet';
const MSCLKID = /^[0-9a-f]{32}$/i;

/** Whether a value has the shape of a Microsoft click id: 32 hex digits, no dashes. */
export function isMsclkid(value: string | null | undefined): value is string {
  return !!value && MSCLKID.test(value);
}

/**
 * Parse a `_uetmsclkid` value: `_uet<32 hex>`. Returns the click id, lowercased, or undefined
 * for anything bat.js itself would not read back.
 */
export function parseUetMsclkid(raw: string | undefined | null): string | undefined {
  if (!raw || !raw.startsWith(UET_MSCLKID_PREFIX)) return undefined;
  const clickId = raw.slice(UET_MSCLKID_PREFIX.length);
  return MSCLKID.test(clickId) ? clickId.toLowerCase() : undefined;
}

/** Build a `_uetmsclkid` value in bat.js's own format. */
export function formatUetMsclkid(clickId: string): string {
  return `${UET_MSCLKID_PREFIX}${clickId.toLowerCase()}`;
}

/**
 * The click id as the Conversions API wants it: a dashed, lowercase UUID. The URL and the cookie
 * carry the 32-hex form; a value in any other shape is returned untouched for the API to judge.
 */
export function formatMsclkid(clickId: string): string {
  const id = clickId.trim().toLowerCase();
  if (!MSCLKID.test(id)) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export type ResolveClickIdCookiesInput = {
  /** The absolute request URL (must include the query string). */
  url: string;
  /** The raw `Cookie` request header, if any. */
  cookieHeader?: string | null;
  /** Overridable clock, primarily for tests. Defaults to `Date.now()`. */
  now?: number;
  /**
   * `Domain` attribute for the emitted cookies: the site's registrable domain, e.g.
   * `.shware.io`, where the pixels write theirs. Required in production: a host-only cookie is a
   * second cookie of the same name next to the pixel's, which the pixel then reads — or deletes,
   * as Reddit's does at every subdomain level before writing its own. `null` for a host-only
   * cookie, which only a local `localhost` setup should ask for.
   */
  domain: string | null;
  /** `Secure` attribute, default true. Set false only for local http testing. */
  secure?: boolean;
  /** subdomainIndex for a freshly built `_fbc` (see {@link formatFbc}). Default 1. */
  subdomainIndex?: number;
  /**
   * Re-issue the stored click and browser ids on every call. On by default, as an ITP self-heal:
   * cookies follow last-writer-wins, so when a pixel has rewritten one through `document.cookie`
   * (Safari caps JS-written cookies at 7 days, 24h on an ad-decorated landing), re-issuing the
   * long-lived HTTP cookie on the next navigation restores it — the same continuous-re-issue
   * mitigation the sGTM ecosystem uses (stape Cookie Keeper, Cookie Monster). `_fbc` and
   * `_gcl_*` are re-issued byte-for-byte at their *remaining* lifetime, so their window never
   * slides (Meta warns on a moved fbclid); the others at the lifetime their pixel itself gives
   * them on every page load (see each below).
   *
   * Set false to strictly follow Meta's documented conditional-write rule ("only set the cookie if
   * it doesn't exist or the fbclid changed") — e.g. to keep pages CDN-cacheable, since the
   * re-issue attaches a per-user `Set-Cookie` (forcing `no-store`) to every response carrying an
   * `_fbc`.
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
  /** The resolved Google Ads click id (from the URL or a still-valid `_gcl_aw`). */
  gclid?: string;
  /** The resolved iOS web-to-app click id (from the URL or a still-valid `_gcl_gb`). */
  wbraid?: string;
  /** The resolved Microsoft Ads click id (from the URL or `_uetmsclkid`), 32-hex form. */
  msclkid?: string;
};

function searchParams(url: string): URLSearchParams {
  try {
    return new URL(url).searchParams;
  } catch {
    // Fall back to a manual split so a relative or slightly malformed URL still yields the query.
    const q = url.indexOf('?');
    return new URLSearchParams(q !== -1 ? url.slice(q + 1) : '');
  }
}

/**
 * Resolve the click-id cookies to set on the current document response.
 *
 * `_fbc` follows Meta's documented conditional-write rule value-wise: a new fbclid (or an absent
 * cookie) opens a fresh 90-day window; a same-fbclid cookie keeps its original value and
 * `creationTime`. Expired (>90d) or malformed values are cleared instead of forwarded. By default,
 * ({@link ResolveClickIdCookiesInput.refresh}) a still-valid cookie is re-issued unchanged at its
 * *remaining* lifetime — never `now + 90d` — so a returning visitor's window cannot slide forward
 * (which is what makes Meta flag an expired fbclid).
 */
export function resolveClickIdCookies(
  input: ResolveClickIdCookiesInput
): ResolveClickIdCookiesResult {
  const { url, cookieHeader, domain, secure = true, subdomainIndex = 1, refresh = true } = input;
  const now = input.now ?? Date.now();

  const params = searchParams(url);
  const jar = parseCookie(cookieHeader ?? '');
  const cookies: SetCookie[] = [];
  const result: ResolveClickIdCookiesResult = { cookies };

  const base = { path: '/', secure, sameSite: 'lax', domain: domain ?? undefined } as const;
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
      // Same fbclid: the value and creationTime are preserved (Meta's rule); refresh (default)
      // re-issues it unchanged at its remaining lifetime as an ITP self-heal.
      result.fbc = existingFbc.raw;
      if (refresh) set(FBC_COOKIE, existingFbc.raw, remainingMs);
    }
  } else if (jar[FBC_COOKIE]) {
    // Malformed leftover — clear it rather than forwarding it to Meta.
    del(FBC_COOKIE);
  }

  // --- Google Ads _gcl_aw / _gcl_gb ---
  // The same first-party HTTP persistence Google's own server-side Conversion Linker performs
  // (it sets FPGCLAW via Set-Cookie for 90 days), applied to gtag's cookies the way the sGTM
  // ecosystem does (stape Cookie Keeper re-issues _gcl_* over HTTP). Ownership is shared with
  // gtag, so the rules are stricter than for _fbc: a value this module cannot parse is left
  // untouched — never rewritten, never deleted — and a re-issue is byte-identical (labels tail
  // included) at the window's REMAINING lifetime, so the 90-day click window never slides.
  const gclsrc = params.get('gclsrc') || undefined;
  const google = [
    {
      cookie: GCL_AW_COOKIE,
      // gtag's own gating (`isGoogleAdsGclid`): a gclid enters _gcl_aw only when gclsrc is
      // absent or 'aw.ds' — 'ds'/'3p.ds' clicks are Search Ads 360's and belong to _gcl_dc.
      urlClickId: isGoogleAdsGclid(gclsrc) ? params.get('gclid') || undefined : undefined,
      assign: (value: string) => (result.gclid = value),
    },
    {
      cookie: GCL_GB_COOKIE,
      urlClickId: params.get('wbraid') || undefined,
      assign: (value: string) => (result.wbraid = value),
    },
  ];
  for (const { cookie, urlClickId, assign } of google) {
    const existing = parseGcl(jar[cookie], now);
    if (urlClickId && GCL_CLICK_ID.test(urlClickId) && urlClickId !== existing?.clickId) {
      // A new click always wins and opens a fresh 90-day window, in gtag's exact format.
      set(cookie, formatGcl(urlClickId, now), GCL_TTL_MS);
      assign(urlClickId);
    } else if (existing) {
      const remainingMs = existing.creationTime + GCL_TTL_MS - now;
      if (remainingMs > 0) {
        assign(existing.clickId);
        if (refresh) set(cookie, existing.raw, remainingMs);
      }
      // Expired: not returned and not re-issued, but gtag owns the deletion.
    }
  }

  // --- Reddit _rdt_cid / _rdt_uuid ---
  // Reddit's pixel.js rewrites both on every page load through `document.cookie` — the click id
  // from the URL, else the stored one, and the browser id — each for a fresh 90 days. So Reddit
  // slides the window itself, and the re-issue (default on, see `refresh`) does the same over
  // HTTP: without it the pixel's JS copy, capped at 7 days in Safari, is the only one left.
  const urlRdtCid = params.get('rdt_cid') || undefined;
  const existingRdtCid = jar[RDT_CID_COOKIE] || undefined;
  if (urlRdtCid && urlRdtCid !== existingRdtCid) {
    set(RDT_CID_COOKIE, urlRdtCid, RDT_CID_TTL_MS);
    result.rdt_cid = urlRdtCid;
  } else if (existingRdtCid) {
    result.rdt_cid = existingRdtCid;
    if (refresh) set(RDT_CID_COOKIE, existingRdtCid, RDT_CID_TTL_MS);
  }
  const existingRdtUuid = jar[RDT_UUID_COOKIE] || undefined;
  if (existingRdtUuid && refresh) set(RDT_UUID_COOKIE, existingRdtUuid, RDT_UUID_TTL_MS);

  // --- Meta _fbp ---
  // The pixel's browser id: created by the pixel, which rewrites it for 90 days on every page
  // load, as Reddit's does its own. Re-issued as it is, never created here.
  const existingFbp = jar[FBP_COOKIE] || undefined;
  if (existingFbp && refresh) set(FBP_COOKIE, existingFbp, FBP_TTL_MS);

  // --- OpenAI __oppref / __obref ---
  // oaiq writes `__oppref` only when the URL carries `oppref` (30 days), and `__obref` — its
  // browser reference — only when there is none (365 days); otherwise it reads them, through
  // `document.cookie`, so in Safari each is gone after 7 days and the browser starts over with a
  // new reference. The first is captured here from the URL as well, and both are re-issued as
  // they are, `__obref` never created. Unlike oaiq, the re-issue restarts their windows: their
  // values carry no creation time to count a remaining lifetime from, and OpenAI applies its own
  // attribution window to the click whatever the cookie's age. Nothing is written once the
  // visitor has opted out of oaiq, which deletes both cookies then.
  if (jar[OAIQ_CONSENT_COOKIE] !== 'false') {
    const urlOppref = params.get('oppref') || undefined;
    const existingOppref = jar[OPPREF_COOKIE] || undefined;
    if (urlOppref) set(OPPREF_COOKIE, urlOppref, OPPREF_TTL_MS);
    else if (existingOppref && refresh) set(OPPREF_COOKIE, existingOppref, OPPREF_TTL_MS);
    const existingObref = jar[OBREF_COOKIE] || undefined;
    if (existingObref && refresh) set(OBREF_COOKIE, existingObref, OBREF_TTL_MS);
  }

  // --- Microsoft Ads _uetmsclkid ---
  // The UET tag's own cookie, in its own format, so the tag and this module read each other's
  // writes. Microsoft's ITP answer is this first-party cookie (plus a localStorage backup), but
  // bat.js writes it through `document.cookie`, which Safari caps at 7 days — 24 hours on a
  // landing page decorated by a classified domain, and a bing.com ad click is exactly that.
  // Persisting it here over HTTP on the document response restores the 90-day window.
  //
  // The re-issue (default on, see `refresh`) is the same self-heal as for `_fbc`, and it matters
  // more here: bat.js rewrites this cookie on EVERY page load, so without the re-issue the HTTP
  // copy is downgraded to a JS cookie on the very next page. There is no embedded timestamp to
  // compute a remaining lifetime from, so it is re-issued at a fresh 90 days — which is exactly
  // what bat.js itself does on each page (`msClkIdExpirationTime` from now), so the window
  // slides no more than the tag already slides it. A value this module cannot parse belongs to
  // the tag: never rewritten, never deleted.
  const urlMsclkid = params.get('msclkid')?.trim();
  const existingMsclkid = parseUetMsclkid(jar[UET_MSCLKID_COOKIE]);
  if (urlMsclkid && MSCLKID.test(urlMsclkid) && urlMsclkid.toLowerCase() !== existingMsclkid) {
    set(UET_MSCLKID_COOKIE, formatUetMsclkid(urlMsclkid), MSCLKID_TTL_MS);
    result.msclkid = urlMsclkid.toLowerCase();
  } else if (existingMsclkid) {
    result.msclkid = existingMsclkid;
    if (refresh) set(UET_MSCLKID_COOKIE, formatUetMsclkid(existingMsclkid), MSCLKID_TTL_MS);
  }

  return result;
}

/** Serialize the resolved cookies into `Set-Cookie` header values. */
export function toSetCookieHeaders(cookies: SetCookie[]): string[] {
  return cookies.map((cookie) => stringifySetCookie(cookie));
}
