import Bowser from 'bowser';
import { parseCookie } from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import { parseGcl, parseUetMsclkid } from '../click-id/index';
import { keys } from '../constants/storage';
import { type Link, getLink } from '../link/index';
import { type Storage, cache, config } from '../setup/index';
import type { TrackTags } from '../track/types';

// lib.dom types `crypto.randomUUID` as always present, but it is missing in insecure contexts
// and older browsers, so probe it before use.
function randomUUID(): string {
  return (crypto as Partial<Crypto>).randomUUID ? crypto.randomUUID() : uuidv4();
}

export function getDeviceId() {
  const cached = config.storage.getItem(keys.device_id);
  if (cached) return cached;
  const id = randomUUID();
  config.storage.setItem(keys.device_id, id);
  return id;
}

/**
 * The current page load, keyed by the path it was loaded at. A module variable and nothing more
 * persistent: the id must die with the page (a reload is a new page load, and storage would
 * carry it over — or, shared across tabs, let two pages overwrite each other's).
 *
 * Keyed by `pathname` because that is what the SDK's own `page_view` fires on (see
 * `useWebAnalytics`): the id exists to link an event to the `page_view` of the page it happened
 * on, so it must rotate exactly when a `page_view` is sent — not on a query or hash change,
 * which sends none and would leave the events after it pointing at a page load no event
 * reported.
 */
let pageLoad: { path: string; id: string } | undefined;

function getPageLoadId(path: string): string {
  if (pageLoad?.path !== path) pageLoad = { path, id: randomUUID() };
  return pageLoad.id;
}

const links = new Map<string, Promise<Link | null>>();

/**
 * `getTags` runs once per event now, and the link a `?s=` id points at cannot change while the
 * page is open, so an uncached lookup would put an identical request on the wire for every
 * event the page sends.
 */
function getCachedLink(id: string) {
  const cached = links.get(id);
  if (cached) return cached;
  const link = getLink(id).then((result) => {
    // A lookup that came back empty must not stick for the lifetime of the page. `getLink`
    // answers null for a network failure as well as for a link that does not exist, and losing
    // the link's utm params for every later event costs more than repeating a rare request.
    if (!result) links.delete(id);
    return result;
  });
  links.set(id, link);
  return link;
}

/** The user agent cannot change while the page is open, so it is parsed once. */
let parser: ReturnType<typeof Bowser.getParser> | undefined;

export async function getTags() {
  // Read the page before the first await: `getTags` runs when the event happens, and a single
  // page app can navigate while the link lookup below is still in flight.
  const page_location = window.location.href;
  const page_load_id = getPageLoadId(window.location.pathname);
  const page_referrer = document.referrer || undefined;
  const page_title = document.title;

  parser ??= Bowser.getParser(window.navigator.userAgent);
  const params = new URLSearchParams(window.location.search);
  const os = parser.getOS();
  const browser = parser.getBrowser();
  const platform = parser.getPlatform();
  const parsed = parseCookie(document.cookie);

  const linkId = params.get('s');
  const link = linkId ? await getCachedLink(linkId) : null;

  const tags: TrackTags = {
    os: `${os.name} ${os.version}`,
    os_name: os.name,
    os_version: os.version,
    browser: `${browser.name} ${browser.version}`,
    browser_name: browser.name,
    browser_version: browser.version,
    device: platform.model,
    device_id: getDeviceId(),
    device_type: platform.type,
    device_vendor: platform.vendor,
    device_pixel_ratio: window.devicePixelRatio,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    release: config.release,
    language: navigator.language,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    page_location,
    page_referrer,
    page_title,
    page_load_id,
    // Meta Ads — _fbc is set server-side (see @shware/analytics/server resolveClickIdCookies)
    fbc: parsed._fbc ?? undefined,
    fbp: parsed._fbp,
    fbclid: params.get('fbclid') ?? undefined,
    ad_id: params.get('ad_id') ?? undefined,
    ad_name: params.get('ad_name') ?? undefined,
    adset_id: params.get('adset_id') ?? undefined,
    adset_name: params.get('adset_name') ?? undefined,
    campaign_id: params.get('campaign_id') ?? undefined,
    campaign_name: params.get('campaign_name') ?? undefined,
    placement: params.get('placement') ?? undefined,
    site_source_name: params.get('site_source_name') ?? undefined,
    // Google Ads — _gcl_aw/_gcl_gb are written by gtag and kept alive server-side (see
    // @shware/analytics/server resolveClickIdCookies); the URL wins, the cookie carries the
    // click id to every later page of the visit and to returning visits.
    gclid: params.get('gclid') ?? parseGcl(parsed._gcl_aw)?.clickId,
    gclsrc: params.get('gclsrc') ?? undefined,
    gad_source: params.get('gad_source') ?? undefined,
    gad_campaignid: params.get('gad_campaignid') ?? undefined,
    // Reddit Ads — _rdt_cid is set server-side (see @shware/analytics/server resolveClickIdCookies)
    rdt_cid: params.get('rdt_cid') ?? parsed._rdt_cid ?? undefined,
    rdt_uuid: parsed._rdt_uuid,
    // LinkedIn Ads: get click id from url params or first-party cookie
    li_fat_id: params.get('li_fat_id') ?? parsed.li_fat_id ?? undefined,
    // click ids
    dclid: params.get('dclid') ?? undefined,
    ko_click_id: params.get('ko_click_id') ?? undefined,
    // Microsoft Ads — _uetmsclkid is written by the UET tag and kept alive server-side (see
    // @shware/analytics/server resolveClickIdCookies); the URL wins, the cookie carries the
    // click id to every later page of the visit and to returning visits.
    msclkid: params.get('msclkid') ?? parseUetMsclkid(parsed._uetmsclkid),
    sccid: params.get('sccid') ?? undefined,
    ttclid: params.get('ttclid') ?? undefined,
    twclid: params.get('twclid') ?? undefined,
    wbraid: params.get('wbraid') ?? parseGcl(parsed._gcl_gb)?.clickId,
    gbraid: params.get('gbraid') ?? undefined,
    yclid: params.get('yclid') ?? undefined,
    // utm params
    utm_source: link?.utm_source ?? params.get('utm_source') ?? undefined,
    utm_medium: link?.utm_medium ?? params.get('utm_medium') ?? undefined,
    utm_campaign: link?.utm_campaign ?? params.get('utm_campaign') ?? undefined,
    utm_term: link?.utm_term ?? params.get('utm_term') ?? undefined,
    utm_content: link?.utm_content ?? params.get('utm_content') ?? undefined,
    utm_id: link?.utm_id ?? params.get('utm_id') ?? undefined,
    utm_source_platform:
      link?.utm_source_platform ?? params.get('utm_source_platform') ?? undefined,
    utm_creative_format:
      link?.utm_creative_format ?? params.get('utm_creative_format') ?? undefined,
    utm_marketing_tactic:
      link?.utm_marketing_tactic ?? params.get('utm_marketing_tactic') ?? undefined,
  };

  cache.tags = tags;
  return tags;
}

const map = new Map<string, string>();

export const storage: Storage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      console.error('localStorage is not available');
      return map.get(key) ?? null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      console.error('localStorage is not available');
      map.set(key, value);
    }
  },
};
