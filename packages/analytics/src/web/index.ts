import Bowser from 'bowser';
import { parseCookie } from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import { keys } from '../constants/storage';
import { type Link, getLink } from '../link/index';
import { type Storage, cache, config } from '../setup/index';
import type { TrackTags } from '../track/types';
import { getPageKey } from './page-key';

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
 * The current page load, keyed by the page it was loaded at. A module variable and nothing more
 * persistent: the id must die with the page (a reload is a new page load, and storage would
 * carry it over — or, shared across tabs, let two pages overwrite each other's).
 *
 * Keyed by `getPageKey` because that is what the SDK's own `page_view` fires on (see
 * `useWebAnalytics`): the id exists to link an event to the `page_view` of the page it happened
 * on, so it must rotate exactly when a `page_view` is sent — path or query change, yes; hash
 * change or tracking-parameter cleanup, no.
 */
let pageLoad: { page: string; id: string } | undefined;

function getPageLoadId(page: string): string {
  if (pageLoad?.page !== page) pageLoad = { page, id: randomUUID() };
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
  const page_load_id = getPageLoadId(getPageKey(window.location.pathname, window.location.search));
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
    webdriver: navigator.webdriver || undefined,
    release: config.release,
    language: navigator.language,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    page_location,
    page_referrer,
    page_title,
    page_load_id,
    // Ad click ids from the URL, each under its parameter's name: this page's click, which
    // names the visit's channel (`CLICK_ID_CHANNELS`). Never filled from a cookie — a cookie
    // outlives the click; the cookies go below under their own names.
    fbclid: params.get('fbclid') ?? undefined,
    ad_id: params.get('ad_id') ?? undefined,
    ad_name: params.get('ad_name') ?? undefined,
    adset_id: params.get('adset_id') ?? undefined,
    adset_name: params.get('adset_name') ?? undefined,
    campaign_id: params.get('campaign_id') ?? undefined,
    campaign_name: params.get('campaign_name') ?? undefined,
    placement: params.get('placement') ?? undefined,
    gclid: params.get('gclid') ?? undefined,
    gclsrc: params.get('gclsrc') ?? undefined,
    gad_source: params.get('gad_source') ?? undefined,
    gad_campaignid: params.get('gad_campaignid') ?? undefined,
    wbraid: params.get('wbraid') ?? undefined,
    gbraid: params.get('gbraid') ?? undefined,
    dclid: params.get('dclid') ?? undefined,
    msclkid: params.get('msclkid') ?? undefined,
    rdt_cid: params.get('rdt_cid') ?? undefined,
    li_fat_id: params.get('li_fat_id') ?? undefined,
    oppref: params.get('oppref') ?? undefined,
    ko_click_id: params.get('ko_click_id') ?? undefined,
    // Snapchat appends `ScCid`, and URL parameters are case-sensitive.
    ScCid: params.get('ScCid') ?? undefined,
    ttclid: params.get('ttclid') ?? undefined,
    twclid: params.get('twclid') ?? undefined,
    yclid: params.get('yclid') ?? undefined,
    epik: params.get('epik') ?? undefined,
    // The ad platforms' first-party cookies, raw and under the cookie's own name, for the
    // conversion senders only: they carry the click to the later pages and visits where the
    // URL no longer does. `_fbc`, `_rdt_cid`, `_gcl_*` and `_uetmsclkid` are kept alive
    // server-side (see @shware/analytics/server resolveClickIdCookies); the rest are the pixels'.
    _fbc: parsed._fbc || undefined,
    _fbp: parsed._fbp || undefined,
    _gcl_aw: parsed._gcl_aw || undefined,
    _gcl_gb: parsed._gcl_gb || undefined,
    _uetmsclkid: parsed._uetmsclkid || undefined,
    _rdt_cid: parsed._rdt_cid || undefined,
    _rdt_uuid: parsed._rdt_uuid || undefined,
    // The Insight Tag's cookie is itself named `li_fat_id`; renamed so it cannot pass for the
    // URL parameter.
    _li_fat_id: parsed.li_fat_id || undefined,
    __oppref: parsed.__oppref || undefined,
    __obref: parsed.__obref || undefined,
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
