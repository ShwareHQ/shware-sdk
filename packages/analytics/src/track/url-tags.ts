import type { TrackTags } from './types';

/**
 * The URL parameters a landing URL carries that the tags keep, each under its parameter's own name:
 * the ad click ids (`CLICK_ID_CHANNELS`), the ad ids a template writes (Meta's `ad_id` …
 * `placement`, the search ads' `network` and `match_type`), and the utm. A web page reads them from
 * its own URL, an app from the link that opened it — the same names either way, so one session
 * classifies alike wherever it began.
 */
export const URL_TAG_KEYS = [
  'fbclid',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'placement',
  'gclid',
  'gclsrc',
  'gad_source',
  'gad_campaignid',
  'network',
  'match_type',
  'wbraid',
  'gbraid',
  'dclid',
  'msclkid',
  'rdt_cid',
  'li_fat_id',
  'oppref',
  'ko_click_id',
  // Snapchat appends `ScCid`, and URL parameters are case-sensitive.
  'ScCid',
  'ttclid',
  'twclid',
  'yclid',
  'epik',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
] as const satisfies readonly (keyof TrackTags)[];

export type UrlTags = Partial<Record<(typeof URL_TAG_KEYS)[number], string>>;

/** The URL parameters among `URL_TAG_KEYS`; a key the URL does not carry is left out. */
export function urlTags(params: { get(name: string): string | null }): UrlTags {
  const tags: UrlTags = {};
  for (const key of URL_TAG_KEYS) {
    const value = params.get(key);
    if (value !== null) tags[key] = value;
  }
  return tags;
}
