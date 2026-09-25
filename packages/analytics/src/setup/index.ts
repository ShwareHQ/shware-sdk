import { keys } from '../constants/storage';
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
  /**
   * Whether this process is the first launch of the install — the one `first_open` (native) or
   * `first_visit` (web) is sent from. Decided when analytics is set up and held for the process:
   * the hooks that write those markers go through `config.storage`, which does not exist before
   * `setupAnalytics`, so a marker missing here is missing because this install has never sent it.
   * Cleared storage and a reinstall both read as a first launch, exactly as the markers do.
   */
  firstLaunch: boolean;
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

// oxlint-disable typescript/no-non-null-assertion
export const config: Config = {
  endpoint: '',
  release: '0.0.0',
  storage: null!,
  platform: null!,
  environment: null!,
  firstLaunch: false,
  getTags: null!,
  getDeviceId: null!,
  getHeaders: null!,
  thirdPartyTrackers: [],
  thirdPartyUserSetters: [],
};
// oxlint-enable typescript/no-non-null-assertion

export function setupAnalytics(init: Options) {
  config.release = init.release;
  config.storage = init.storage;
  config.platform = init.platform;
  config.environment = init.environment;
  config.firstLaunch = !init.storage.getItem(
    init.platform === 'web' ? keys.first_visit_time : keys.first_open_time
  );
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
