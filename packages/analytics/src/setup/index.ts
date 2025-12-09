import { v7 as uuidv7 } from 'uuid';
import type { ThirdPartyTracker, TrackTags } from '../track/types';
import type { ThirdPartyUserSetter, Visitor } from '../visitor/types';

export interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
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
  endpoint: string;
  storage: Storage;
  getTags: () => TrackTags | Promise<TrackTags>;
  getDeviceId: () => string | Promise<string>;
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  thirdPartyTrackers: ThirdPartyTracker[];
  thirdPartyUserSetters: ThirdPartyUserSetter[];
}

interface Cache {
  tags: TrackTags | null;
  visitor: Visitor | null;
  session: { id: string; startedAt: string };
}

export const cache: Cache = {
  tags: null,
  visitor: null,
  session: { id: uuidv7(), startedAt: new Date().toISOString() },
};

export const config: Config = {
  endpoint: '',
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
