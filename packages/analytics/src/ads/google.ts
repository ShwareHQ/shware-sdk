/**
 * Google Ads delivery pushed by a Google Ads script: the script runs inside the ad account on
 * Google's schedule, reads the hourly report with `AdsApp.search` and posts it to the host, which
 * turns it into `AdPerformanceRow`s here. No developer token, manager account or OAuth client is
 * needed — the script runs as the account's own user. The script is in the README.
 *
 * Google reports hours down to the ad group, not the ad (`segments.hour` is incompatible with
 * `ad_group_ad`), and Performance Max campaigns have no ad groups at all; so a row is an ad group's
 * hour, or a Performance Max campaign's, and `ad_id` holds that ad group or campaign id.
 *
 * https://developers.google.com/google-ads/scripts/docs/features/reports
 * https://developers.google.com/google-ads/api/fields/v21/ad_group
 */
import {
  type infer as Infer,
  array,
  nullable,
  number,
  object,
  optional,
  safeParse,
  string,
  union,
} from 'zod/mini';
import { channelGroupOf } from '../attribution';
import { zonedHourToUtc } from './time';
import type { AdPerformanceRow } from './types';

/** What a Google ad click is in the attribution vocabulary: a `gclid` is `google / cpc`. */
const CHANNEL = 'google';
const MEDIUM = 'cpc';

/** `AdsApp.search` returns int64 metrics as strings and doubles as numbers; either is taken. */
const metric = optional(union([string(), number()]));

const reportRowSchema = object({
  campaign_id: string(),
  campaign_name: optional(nullable(string())),
  /** Null for a Performance Max campaign's row. */
  ad_group_id: optional(nullable(string())),
  ad_group_name: optional(nullable(string())),
  /** `segments.date`, a day in the account's time zone. */
  date: string(),
  /** `segments.hour`, 0–23, of that day. */
  hour: number(),
  cost_micros: metric,
  impressions: metric,
  clicks: metric,
  conversions: metric,
  conversion_value: metric,
});

const reportSchema = object({
  /** The customer id, digits only or as `123-456-7890`. */
  account_id: string(),
  currency: string(),
  /** `AdsApp.currentAccount().getTimeZone()`, the IANA zone `date` and `hour` are in. */
  time_zone: string(),
  rows: array(reportRowSchema),
});

/** The body the Google Ads script posts: the account and its report rows, as read. */
export type GoogleAdsScriptReport = Infer<typeof reportSchema>;

/** A body that is not a `GoogleAdsScriptReport`; the host answers it with a 400. */
export class GoogleAdsReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsReportError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A metric as a number, absent as `fallback`; anything not numeric is an invalid report. */
function numeric<T extends number | null>(
  value: string | number | undefined,
  fallback: T,
  path: string
): number | T {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new GoogleAdsReportError(`${path}: not a number: ${value}`);
  return n;
}

function timeZoneOf(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new GoogleAdsReportError(`Unknown time zone: ${timeZone}`);
  }
  return timeZone;
}

/**
 * The rows of a report a Google Ads script posted, validated, one per ad group (or Performance Max
 * campaign) and hour. The hours are the account's, turned into UTC instants. Spend comes from
 * `cost_micros`. Google's `conversions` are its primary conversion actions under their own
 * attribution model, click-based (view-through conversions are counted apart, without value),
 * so they fill both the total and the click-through columns.
 *
 * Google restates the past — a conversion is credited to the hour of its click, up to the
 * conversion window (30 days by default) later — so the script re-reads a trailing window and the
 * host upserts on (`platform`, `account_id`, `ad_id`, `hour_start`).
 *
 * @throws GoogleAdsReportError when the body is not a report.
 */
export function parseGoogleAdsScriptReport(body: unknown): AdPerformanceRow[] {
  const parsed = safeParse(reportSchema, body);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GoogleAdsReportError(
      `Invalid Google Ads report (${issues.length} issues): ${first}${issues.length > 3 ? '; …' : ''}`
    );
  }

  const report = parsed.data;
  const accountId = report.account_id.replaceAll('-', '');
  const timeZone = timeZoneOf(report.time_zone);
  return report.rows.map((row, index) => {
    const path = `rows.${index}`;
    if (!DATE.test(row.date) || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) {
      throw new GoogleAdsReportError(`${path}: unexpected hour ${row.date} ${row.hour}`);
    }
    const conversions = numeric(row.conversions, null, `${path}.conversions`);
    const value = numeric(row.conversion_value, null, `${path}.conversion_value`);
    return {
      platform: 'google',
      account_id: accountId,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name ?? null,
      ad_group_id: row.ad_group_id ?? null,
      ad_group_name: row.ad_group_name ?? null,
      ad_id: row.ad_group_id ?? row.campaign_id,
      ad_name: null,
      channel: CHANNEL,
      medium: MEDIUM,
      channel_group: channelGroupOf(CHANNEL, MEDIUM),
      hour_start: zonedHourToUtc(row.date, row.hour, timeZone).toISOString(),
      currency: report.currency,
      spend: numeric(row.cost_micros, 0, `${path}.cost_micros`) / 1e6,
      impressions: numeric(row.impressions, 0, `${path}.impressions`),
      clicks: numeric(row.clicks, 0, `${path}.clicks`),
      conversions,
      conversion_value: value,
      click_conversions: conversions,
      click_conversion_value: value,
    };
  });
}
