import Bowser from 'bowser';
import * as cookie from 'cookie';
import { v4 as uuidv4 } from 'uuid';
import type { TrackTags } from '../types';

export function getDeviceId() {
  const cached = localStorage.getItem('device_id');
  if (cached) return cached;
  const id = crypto?.randomUUID ? crypto.randomUUID() : uuidv4();
  localStorage.setItem('device_id', id);
  return id;
}

export function getTags(release: string) {
  const parser = Bowser.getParser(window.navigator.userAgent);
  const params = new URLSearchParams(window.location.search);
  const os = parser.getOS();
  const browser = parser.getBrowser();
  const platform = parser.getPlatform();
  const parsed = cookie.parse(document.cookie);
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
    device_pixel_ratio: `${window.devicePixelRatio}`,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    release,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
    fbc: parsed._fbc,
    fbp: parsed._fbp,
    gclid: params.get('gclid') ?? undefined,
    utm_source: params.get('utm_source') ?? undefined,
    utm_medium: params.get('utm_medium') ?? undefined,
    utm_campaign: params.get('utm_campaign') ?? undefined,
    utm_term: params.get('utm_term') ?? undefined,
    utm_content: params.get('utm_content') ?? undefined,
  };
  return tags;
}
