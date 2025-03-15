import axios, { AxiosInstance } from 'axios';
import { ThirdPartyLogger, TrackTags } from '../../types';

export interface Storage {
  getItem: (key: string) => (string | null) | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

export interface Options {
  release: string;
  storage: Storage;
  endpoint: string;
  getTags: () => Promise<TrackTags>;
  getDeviceId: () => Promise<string>;
  thirdPartyLoggers?: ThirdPartyLogger[];
}

interface Config {
  release: string;
  storage: Storage;
  http: AxiosInstance;
  getTags: () => Promise<TrackTags>;
  getDeviceId: () => Promise<string>;
  thirdPartyLoggers: ThirdPartyLogger[];
}

export const config: Config = {
  http: null!,
  release: '0.0.0',
  storage: null!,
  getTags: null!,
  getDeviceId: null!,
  thirdPartyLoggers: [],
};

export function setupAnalytics(init: Options) {
  config.release = init.release;
  config.storage = init.storage;
  config.getTags = init.getTags;
  config.getDeviceId = init.getDeviceId;
  config.thirdPartyLoggers = init.thirdPartyLoggers ?? [];
  config.http = axios.create({ baseURL: init.endpoint, withCredentials: true, adapter: 'fetch' });
}
