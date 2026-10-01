/**
 * The click id each conversion sender passes on, resolved from an event's tags.
 *
 * The tags keep a URL parameter and the cookie that persists it apart (`gclid` / `_gcl_aw`, see
 * `AdvertisingInfo`). The URL parameter wins: the two only coexist on the landing page, where the
 * parameter is this very click while the cookie may still hold an earlier one — the pixel that
 * rewrites it can run after this SDK read it. On every later page and visit the URL carries
 * nothing and the cookie is what remains of the click.
 *
 * Clients older than 9.0.0 send `fbc` / `fbp` / `rdt_uuid` for the cookies (and may have filled
 * `gclid`, `wbraid`, `msclkid`, `rdt_cid` and `li_fat_id` from them), so those are still read
 * as a fallback. Transitional: drop them here and in `tagsSchema` and `AdvertisingInfo` once no
 * client sends them.
 */
import { formatFbc, parseFbc, parseGcl, parseUetMsclkid } from '../click-id/index';
import type { TrackTags } from '../track/types';

/**
 * Meta's `fbc`: built from this page's `fbclid`, else the `_fbc` cookie. One exception on the
 * landing page: a cookie opened by that same `fbclid` is sent as it is, for its creationTime —
 * `resolveClickIdCookies` sets it on the landing document, before any event of the page.
 */
export function metaFbc(tags: TrackTags, eventTimeMs: number): string | undefined {
  const cookie = tags._fbc ?? tags.fbc;
  if (tags.fbclid) {
    if (parseFbc(cookie)?.fbclid === tags.fbclid) return cookie;
    // ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc#2--format-clickid
    // Without the cookie, creationTime is "the timestamp when you first observed or received
    // this fbclid value" — the event's own time is the closest thing the server has to that,
    // and it does not move when a queued or retried batch finally goes out.
    return formatFbc(tags.fbclid, eventTimeMs);
  }
  return cookie;
}

/** Meta's `fbp`: the pixel's browser id, a cookie only. */
export function metaFbp(tags: TrackTags): string | undefined {
  return tags._fbp ?? tags.fbp;
}

/**
 * Google Ads' click ids, from the URL when it carries any of them, else from gtag's cookies.
 * All or nothing rather than one by one: the sender picks gclid over gbraid / wbraid, so a
 * landing URL with a fresh gbraid next to the `_gcl_aw` of an earlier click would otherwise send
 * the earlier click. gbraid is an app-to-web id and never kept in a cookie.
 */
export function googleClickIds(tags: TrackTags) {
  const { gclid, gbraid, wbraid } = tags;
  if (gclid || gbraid || wbraid) return { gclid, gbraid, wbraid };
  return {
    gclid: parseGcl(tags._gcl_aw)?.clickId,
    gbraid: undefined,
    wbraid: parseGcl(tags._gcl_gb)?.clickId,
  };
}

/** Microsoft Ads' click id, in the 32-hex form of the URL and the cookie. */
export function microsoftMsclkid(tags: TrackTags): string | undefined {
  return tags.msclkid ?? parseUetMsclkid(tags._uetmsclkid);
}

export function redditClickId(tags: TrackTags): string | undefined {
  return tags.rdt_cid ?? tags._rdt_cid;
}

/** The Reddit pixel's browser id, a cookie only. */
export function redditUuid(tags: TrackTags): string | undefined {
  return tags._rdt_uuid ?? tags.rdt_uuid;
}

export function linkedinFatId(tags: TrackTags): string | undefined {
  return tags.li_fat_id ?? tags._li_fat_id;
}

/**
 * OpenAI's `oppref`: the pixel captures it from the landing URL and keeps it in `__oppref` for
 * the later pages, and "the API does not capture `oppref` for you".
 * ref: https://developers.openai.com/ads/measurement-pixel#cookie-expiry
 */
export function openaiOppref(tags: TrackTags): string | undefined {
  return tags.oppref ?? tags.__oppref;
}
