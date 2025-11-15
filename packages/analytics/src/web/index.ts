import Bowser from 'bowser';
import * as cookie from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import { type Link, getLink } from '../link/index';
import { expiringStorage } from '../utils/storage';
import type { Storage } from '../setup/index';
import type { TrackTags } from '../track/types';

export function getDeviceId() {
  const cached = localStorage.getItem('device_id');
  if (cached) return cached;
  const id = crypto?.randomUUID ? crypto.randomUUID() : uuidv4();
  localStorage.setItem('device_id', id);
  return id;
}

export async function getTags(release: string) {
  const parser = Bowser.getParser(window.navigator.userAgent);
  const params = new URLSearchParams(window.location.search);
  const os = parser.getOS();
  const browser = parser.getBrowser();
  const platform = parser.getPlatform();
  const parsed = cookie.parse(document.cookie);

  let link: Link | null = null;
  if (params.has('s')) link = await getLink(params.get('s')!);

  const tags: TrackTags = {
    os: `${os.name} ${os.version}`,
    os_name: os.name,
    os_version: os.version,
    browser: `${browser.name} ${browser.version}`,
    browser_name: browser.name,
    browser_version: browser.version,
    platform: 'web',
    device: platform.model,
    device_id: getDeviceId(),
    device_type: platform.type,
    device_vendor: platform.vendor,
    device_pixel_ratio: window.devicePixelRatio,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    release,
    language: navigator.language,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
    source: 'web',
    source_url: window.location.origin + window.location.pathname,
    // meta ads
    fbc: parsed._fbc ?? expiringStorage.getItem<string>('fbc') ?? undefined,
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
    // google ads
    gclid: params.get('gclid') ?? undefined,
    gclsrc: params.get('gclsrc') ?? undefined,
    gad_source: params.get('gad_source') ?? undefined,
    gad_campaignid: params.get('gad_campaignid') ?? undefined,
    // reddit ads
    rdt_cid:
      params.get('rdt_cid') ??
      parsed._rdt_cid ??
      expiringStorage.getItem<string>('rdt_cid') ??
      undefined,
    rdt_uuid: parsed._rdt_uuid,
    // linkedin ads: get click id from url params or first-party cookie
    li_fat_id: params.get('li_fat_id') ?? parsed.li_fat_id ?? undefined,
    // click ids
    dclid: params.get('dclid') ?? undefined,
    ko_click_id: params.get('ko_click_id') ?? undefined,
    msclkid: params.get('msclkid') ?? undefined,
    sccid: params.get('sccid') ?? undefined,
    ttclid: params.get('ttclid') ?? undefined,
    twclid: params.get('twclid') ?? undefined,
    wbraid: params.get('wbraid') ?? undefined,
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
