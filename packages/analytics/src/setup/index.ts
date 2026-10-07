import type { Environment, Platform, ThirdPartyTracker, TrackTags } from '../track/types';
import type { ThirdPartyUserSetter } from '../visitor/types';

export interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * The link that opened the current visit of an app — a universal link, an app link, a custom
 * scheme — whose URL, utm and click ids land the visit as a web page's URL does.
 * `@shware/analytics/native` provides one (`deepLink`).
 */
export interface DeepLink {
  /** Starts following the links that open the app; `setupAnalytics` calls it once. */
  listen: () => void;
  /** The opening link's tags (`page_location`, utm, click ids); empty without one. */
  getTags: () => TrackTags | Promise<TrackTags>;
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
  /** An app's opening link, its tags merged into every event's over `getTags`'s. */
  deepLink?: DeepLink;
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
  deepLink: DeepLink | undefined;
}

interface Cache {
  tags: TrackTags | null;
}

export const cache: Cache = {
  tags: null,
};

// oxlint-disable typescript/no-non-null-assertion
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
  deepLink: undefined,
};
// oxlint-enable typescript/no-non-null-assertion

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
  config.deepLink = init.deepLink;
  // Logged, not thrown: the links are worth less than the setup they would break.
  try {
    init.deepLink?.listen();
  } catch (error) {
    console.error('analytics deepLink.listen failed', error);
  }
}
