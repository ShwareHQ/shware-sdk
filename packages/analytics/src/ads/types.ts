import type { ChannelGroup } from '../attribution';

/** The ad platforms whose reporting APIs this module reads. */
export type AdPlatform = 'meta' | 'google';

/**
 * One row of ad delivery: one ad over one hour. The row a host stores in its `ad_performance`
 * table, unique on (`platform`, `account_id`, `ad_id`, `hour_start`).
 *
 * Every platform yields hourly rows, so that a sum over any span in any time zone — the way the
 * host's attribution is grouped — is a sum of whole rows, and a table never mixes a day row with
 * the hour rows inside it (an upsert would overwrite one with the other on the shared start, and
 * the rest would count twice). A platform that reports only days spreads each day evenly over its
 * hours, the counts then fractional.
 *
 * `channel`, `medium` and `channel_group` use the attribution vocabulary (`classifyTouch`), so a
 * row joins the host's sessions and attribution on the same values with no mapping in SQL.
 */
export interface AdPerformanceRow {
  /** The reporting API the row came from; `channel` is what it joins attribution on. */
  platform: AdPlatform;
  /** The platform's account id, without a prefix or dashes (Meta's `act_`, Google's `123-`). */
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  /** The level between campaign and ad: Meta's ad set, Google's ad group. */
  ad_group_id: string | null;
  ad_group_name: string | null;
  /**
   * The finest level the platform reports hours at: the ad on Meta; on Google the ad group, or the
   * campaign for Performance Max, which has none.
   */
  ad_id: string;
  ad_name: string | null;
  channel: string;
  medium: string;
  channel_group: ChannelGroup;
  /** The start of the hour, an ISO 8601 UTC instant; the row covers the hour that follows. */
  hour_start: string;
  /** The account's currency, ISO 4217; every amount of the row is in it. */
  currency: string;
  spend: number;
  impressions: number;
  /**
   * Clicks to the advertiser's site — Meta's `inline_link_clicks`, not `clicks`, which also counts
   * likes, expands and profile taps. The number to compare with the sessions an ad brought.
   */
  clicks: number;
  /**
   * The platform's own count of the conversion event (and its value) under the attribution
   * setting of the ad — view-through included. Null when the platform reported none.
   */
  conversions: number | null;
  conversion_value: number | null;
  /** The click-through part only: the platform's number to set against a click-based attribution. */
  click_conversions: number | null;
  click_conversion_value: number | null;
}

/** A calendar date, `YYYY-MM-DD`, in the ad account's own time zone. */
export type ReportDate = `${number}-${number}-${number}`;
