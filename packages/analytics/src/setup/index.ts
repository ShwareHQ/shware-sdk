import axios, { AxiosInstance } from 'axios';
import retry from 'axios-retry';
import type { ThirdPartyTracker, TrackTags } from '../track/types';
import type { ThirdPartyUserSetter } from '../visitor/types';

export interface Storage {
  getItem: (key: string) => (string | null) | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

export interface Options {
  release: string;
  storage: Storage;
  endpoint: string;
  getTags: () => TrackTags | Promise<TrackTags>;
  getDeviceId: () => string | Promise<string>;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  thirdPartyTrackers?: ThirdPartyTracker[];
  thirdPartyUserSetters?: ThirdPartyUserSetter[];
}

interface Config {
  release: string;
  storage: Storage;
  http: AxiosInstance;
  getTags: () => TrackTags | Promise<TrackTags>;
  getDeviceId: () => string | Promise<string>;
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  thirdPartyTrackers: ThirdPartyTracker[];
  thirdPartyUserSetters: ThirdPartyUserSetter[];
}

export const config: Config = {
  http: null!,
  release: '0.0.0',
  storage: null!,
  getTags: null!,
  getDeviceId: null!,
  getHeaders: null!,
  thirdPartyTrackers: [],
  thirdPartyUserSetters: [],
};

export function setupAnalytics(init: Options) {
  config.release = init.release;
  config.storage = init.storage;
  config.getTags = init.getTags;
  config.getDeviceId = init.getDeviceId;
  config.getHeaders = init.getHeaders ?? (() => ({}));
  config.thirdPartyTrackers = init.thirdPartyTrackers ?? [];
  config.thirdPartyUserSetters = init.thirdPartyUserSetters ?? [];
  config.http = axios.create({ baseURL: init.endpoint, withCredentials: true, adapter: 'fetch' });
  retry(config.http, { retries: 5, retryDelay: retry.exponentialDelay });
}
