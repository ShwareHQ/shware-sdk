import type { Environment, Platform, ThirdPartyTracker, TrackTags } from '../track/types';
import type { ThirdPartyUserSetter, Visitor } from '../visitor/types';

export interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface Options {
  release: string;
  storage: Storage;
  endpoint: string;
  platform: Platform;
  environment: Environment;
  getTags: () => TrackTags | Promise<TrackTags>;
  getDeviceId: () => string | Promise<string>;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  thirdPartyTrackers?: ThirdPartyTracker[];
  thirdPartyUserSetters?: ThirdPartyUserSetter[];
}

interface Config {
  release: string;
  endpoint: string;
  storage: Storage;
  platform: Platform;
  environment: Environment;
  getTags: () => TrackTags | Promise<TrackTags>;
  getDeviceId: () => string | Promise<string>;
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  thirdPartyTrackers: ThirdPartyTracker[];
  thirdPartyUserSetters: ThirdPartyUserSetter[];
}

interface Cache {
  tags: TrackTags | null;
  visitor: Visitor | null;
}

export const cache: Cache = {
  tags: null,
  visitor: null,
};

export const config: Config = {
  endpoint: '',
  release: '0.0.0',
  storage: null!,
  platform: null!,
  environment: null!,
  getTags: null!,
  getDeviceId: null!,
  getHeaders: null!,
  thirdPartyTrackers: [],
  thirdPartyUserSetters: [],
};

export function setupAnalytics(init: Options) {
  config.release = init.release;
  config.storage = init.storage;
  config.platform = init.platform;
  config.environment = init.environment;
  config.endpoint = init.endpoint.endsWith('/') ? init.endpoint.slice(0, -1) : init.endpoint;
  config.getTags = init.getTags;
  config.getDeviceId = init.getDeviceId;
  config.getHeaders = async () => ({
    'Content-Type': 'application/json',
    ...(await init.getHeaders?.()),
  });
  config.thirdPartyTrackers = init.thirdPartyTrackers ?? [];
  config.thirdPartyUserSetters = init.thirdPartyUserSetters ?? [];
}
