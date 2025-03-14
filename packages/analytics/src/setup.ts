import axios from 'axios';
import Bowser from 'bowser';
import cookie from 'cookie';
import retry from 'axios-retry';
import { v4 as uuidv4 } from 'uuid';
import { TokenBucket, TokenBucketOptions } from './utils';
import { ThirdPartyLogger, TrackTags } from './types';

export interface Storage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export interface Options {
  release: string;
  endpoint: string;
  storage?: Storage;
  platform?: 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux' | 'unknown';
  rateLimiter?: TokenBucketOptions;
  tagsFetcher?: () => Promise<TrackTags>;
  deviceIdFetcher?: () => Promise<string>;
  thirdPartyLoggers?: ThirdPartyLogger[];
}

export const options: Partial<Omit<Options, 'rateLimiter'>> & {
  tokenBucket: TokenBucket;
} = {
  tokenBucket: new TokenBucket({ rate: 1, capacity: 20, requested: 2 }),
};

export const http = axios.create({ withCredentials: true, adapter: 'fetch' });
retry(http, { retries: 5, retryDelay: retry.exponentialDelay });

export async function browserTagsFetcher(release?: string) {
  const parser = Bowser.getParser(window.navigator.userAgent);
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
    device_id: await options.deviceIdFetcher!(),
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
  };
  return tags;
}

export function setupAnalytics(init: Options) {
  http.defaults.baseURL = init.endpoint;
  if (init.rateLimiter) {
    options.tokenBucket = new TokenBucket(init.rateLimiter);
  }

  // This is a browser-only feature
  if (typeof window !== 'undefined') {
    if (!init.storage) {
      options.storage = {
        getItem: async (key: string) => localStorage.getItem(key),
        setItem: async (key: string, value: string) => localStorage.setItem(key, value),
      };
    }
    if (!init.deviceIdFetcher) {
      options.deviceIdFetcher = () =>
        new Promise<string>((resolve) => {
          const cached = localStorage.getItem('device_id');
          if (cached) return cached;
          const id = crypto?.randomUUID ? crypto.randomUUID() : uuidv4();
          localStorage.setItem('device_id', id);
          resolve(id);
        });
    }
    if (!init.tagsFetcher) {
      options.tagsFetcher = () => browserTagsFetcher(init.release);
    }
  }

  Object.assign(options, init);
}
