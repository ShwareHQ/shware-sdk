/**
 * Microsoft Advertising delivery pushed by a Microsoft Advertising script: the script runs inside
 * the ad account on Microsoft's schedule and posts its stats to the host, which turns them into
 * `AdPerformanceRow`s here — no developer token, Azure app or OAuth consent, the script runs as
 * the account's own user. The script is in the README.
 *
 * Microsoft Advertising scripts have no report query (there is no `AdsApp.report`), only each
 * entity's stats over a date range, and no hour: the script reads every ad group's stats one day
 * at a time, and each day is spread evenly over the hours of the account's day (`spreadDay`), so
 * the table stays hourly. A row is an ad group's hour, and `ad_id` holds the ad group id.
 *
 * https://learn.microsoft.com/advertising/scripts/reference/adgroup
 * https://learn.microsoft.com/advertising/scripts/reference/stats
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
import { spreadDay } from './spread';
import type { AdPerformanceRow } from './types';

/** What a Microsoft ad click is in the attribution vocabulary: an `msclkid` is `microsoft / cpc`. */
const CHANNEL = 'microsoft';
const MEDIUM = 'cpc';

/** Stats getters return numbers; a string of one is taken too. */
const metric = optional(nullable(union([string(), number()])));
const id = union([string(), number()]);

const reportRowSchema = object({
  campaign_id: id,
  campaign_name: optional(nullable(string())),
  ad_group_id: id,
  ad_group_name: optional(nullable(string())),
  /** The day the stats cover, `YYYY-MM-DD` in the account's time zone. */
  date: string(),
  /** `getCost()`, in the account's currency (not micros). */
  spend: metric,
  impressions: metric,
  clicks: metric,
  conversions: metric,
  /** `getRevenue()`, the conversions' value. */
  revenue: metric,
});

const reportSchema = object({
  /** `AdsApp.currentAccount().getAccountId()`, the numeric account id. */
  account_id: id,
  currency: string(),
  /** `AdsApp.currentAccount().getTimeZone()`, the IANA zone `date` is in. */
  time_zone: string(),
  rows: array(reportRowSchema),
});

/** The body the Microsoft Advertising script posts: the account and its ad group days. */
export type MicrosoftAdsScriptReport = Infer<typeof reportSchema>;

/** A body that is not a `MicrosoftAdsScriptReport`; the host answers it with a 400. */
export class MicrosoftAdsReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftAdsReportError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A metric as a number, absent as `fallback`; anything not numeric is an invalid report. */
function numeric<T extends number | null>(
  value: string | number | null | undefined,
  fallback: T,
  path: string
): number | T {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new MicrosoftAdsReportError(`${path}: not a number: ${value}`);
  return n;
}

function timeZoneOf(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new MicrosoftAdsReportError(`Unknown time zone: ${timeZone}`);
  }
  return timeZone;
}

/**
 * The rows of a report a Microsoft Advertising script posted, validated: each ad group day spread
 * over the hours of the account's day (24, or 23 / 25 across a daylight-saving change). Whole-day
 * sums are Microsoft's exactly; the hours inside a day are an even split. Microsoft's
 * `conversions` are click-through (view-through ones are a separate count), so they fill both the
 * total and the click-through columns.
 *
 * Microsoft restates the past — a conversion is credited to its click's day up to the conversion
 * window (30 days by default) later — so the script re-reads a trailing window and the host upserts
 * on (`platform`, `account_id`, `ad_id`, `hour_start`). The script posts whole days only: a day
 * still running would be spread over hours that have not happened.
 *
 * @throws MicrosoftAdsReportError when the body is not a report.
 */
export function parseMicrosoftAdsScriptReport(body: unknown): AdPerformanceRow[] {
  const parsed = safeParse(reportSchema, body);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new MicrosoftAdsReportError(
      `Invalid Microsoft Advertising report (${issues.length} issues): ${first}${issues.length > 3 ? '; …' : ''}`
    );
  }

  const report = parsed.data;
  const accountId = String(report.account_id);
  const timeZone = timeZoneOf(report.time_zone);
  return report.rows.flatMap((row, index) => {
    const path = `rows.${index}`;
    if (!DATE.test(row.date))
      throw new MicrosoftAdsReportError(`${path}: unexpected date ${row.date}`);
    const conversions = numeric(row.conversions, null, `${path}.conversions`);
    const value = numeric(row.revenue, null, `${path}.revenue`);
    const adGroupId = String(row.ad_group_id);
    const day: AdPerformanceRow = {
      platform: 'microsoft',
      account_id: accountId,
      campaign_id: String(row.campaign_id),
      campaign_name: row.campaign_name ?? null,
      ad_group_id: adGroupId,
      ad_group_name: row.ad_group_name ?? null,
      ad_id: adGroupId,
      ad_name: null,
      channel: CHANNEL,
      medium: MEDIUM,
      channel_group: channelGroupOf(CHANNEL, MEDIUM),
      hour_start: '',
      currency: report.currency,
      spend: numeric(row.spend, 0, `${path}.spend`),
      impressions: numeric(row.impressions, 0, `${path}.impressions`),
      clicks: numeric(row.clicks, 0, `${path}.clicks`),
      conversions,
      conversion_value: value,
      click_conversions: conversions,
      click_conversion_value: value,
    };
    return spreadDay(day, row.date, timeZone);
  });
}
