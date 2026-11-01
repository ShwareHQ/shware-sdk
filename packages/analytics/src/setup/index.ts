import type { Integration } from '../third-parties/integration';
import type { Environment, EventName, Platform, TrackTags } from '../track/types';

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
  /**
   * The third parties events and the signed-in user go to, each configured in one place
   * (`googleAnalytics`, `metaAds`, … from `@shware/analytics/third-parties`). Pass the same array
   * to `<Analytics integrations>` for their scripts.
   */
  integrations?: readonly Integration[];
  /**
   * Events reported server-side only (the Conversions APIs, Google's Data Manager API): stored
   * like any event, but handed to no browser tracker, analytics included — a browser copy under
   * another event id would be counted twice by the platforms. `purchase` and `refund`, typically.
   */
  excludeFromIntegrations?: readonly EventName[];
  /** An app's opening link, which native's `getTags` merges into every event's tags. */
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
  integrations: readonly Integration[];
  excludeFromIntegrations: readonly string[];
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
  integrations: [],
  excludeFromIntegrations: [],
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
  config.integrations = init.integrations ?? [];
  config.excludeFromIntegrations = init.excludeFromIntegrations ?? [];
  config.deepLink = init.deepLink;
  // Logged, not thrown: the links are worth less than the setup they would break.
  try {
    init.deepLink?.listen();
  } catch (error) {
    console.error('analytics deepLink.listen failed', error);
  }
}
