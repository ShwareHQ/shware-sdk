/**
 * Meta ad delivery through the Marketing API's Insights endpoint, over plain `fetch`: one row per
 * ad and hour, in the attribution vocabulary (see `AdPerformanceRow`).
 *
 * The token needs `ads_read` on the ad account — a system user token with the account assigned
 * at "View performance". It is sent in the `Authorization` header and never put in a URL: paging
 * follows the `after` cursor rather than Meta's `paging.next`, which embeds the token.
 *
 * https://developers.facebook.com/docs/marketing-api/insights
 * https://developers.facebook.com/docs/marketing-api/insights/breakdowns
 */
import { createHmac } from 'node:crypto';
import { fetch } from '@shware/utils';
import {
  type infer as Infer,
  type ZodMiniType,
  array,
  number,
  object,
  optional,
  safeParse,
  string,
} from 'zod/mini';
import { channelGroupOf } from '../attribution';
import { addDays, addMonths, todayIn, zonedHourToUtc } from './time';
import type { AdPerformanceRow, ReportDate } from './types';

/** Same Graph API version as the Conversions API sender. */
const API_VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

/** What an ad click is in the attribution vocabulary: `meta / cpc`, a paid social touch. */
const CHANNEL = 'meta';
const MEDIUM = 'cpc';

/**
 * The click window of the click-through columns. Meta's longest since 2021, and the click part of
 * its default setting (7-day click, 1-day view).
 */
const CLICK_WINDOW = '7d_click';
const VIEW_WINDOW = '1d_view';

const HOURLY = 'hourly_stats_aggregated_by_advertiser_time_zone';

/**
 * How far back Meta answers the hourly breakdown, in months. Past it Meta does not fail — it
 * returns no rows — so a backfill would silently store a gap.
 * https://developers.facebook.com/docs/marketing-api/insights/best-practices
 */
const HOURLY_RETENTION_MONTHS = 13;

/**
 * Days per Insights request. A synchronous request over a long range of ad rows times out on
 * Meta's side (`code 1, subcode 99`, "An unknown error occurred", as a 500): 17 months of daily
 * ad rows did. A range is split into windows this long, each paged on its own.
 */
const CHUNK_DAYS = 7;

const FIELDS = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'inline_link_clicks',
  'actions',
  'action_values',
];

export interface MetaAdPerformanceOptions {
  /** A token with `ads_read` on the account. */
  accessToken: string;
  /** The ad account id, with or without its `act_` prefix. */
  accountId: string;
  /** First day, in the ad account's time zone. */
  since: ReportDate;
  /** Last day, inclusive, in the ad account's time zone. */
  until: ReportDate;
  /**
   * The `action_type` counted as the conversion, default `purchase` (Meta's total of the pixel,
   * Conversions API and in-app purchases of an event, deduplicated).
   */
  conversionActionType?: string;
  /**
   * The app secret, when the app requires `appsecret_proof` (App settings → Advanced → "Require
   * app secret"). The proof is computed here; the secret itself is never sent.
   */
  appSecret?: string;
}

/** A Graph API error, with Meta's code, for a caller deciding whether to retry. */
export class MetaAdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly subcode: number | undefined,
    readonly fbtraceId: string | undefined
  ) {
    super(message);
    this.name = 'MetaAdsApiError';
  }
}

const actionSchema = object({
  action_type: string(),
  /**
   * The count under the ad's own attribution setting. Absent when the setting does not count any
   * of it — a view-only conversion of an ad set to 1-day click — which only shows in the windows.
   */
  value: optional(string()),
  [CLICK_WINDOW]: optional(string()),
  [VIEW_WINDOW]: optional(string()),
});

const insightSchema = object({
  ad_id: string(),
  ad_name: optional(string()),
  adset_id: optional(string()),
  adset_name: optional(string()),
  campaign_id: string(),
  campaign_name: optional(string()),
  spend: optional(string()),
  impressions: optional(string()),
  inline_link_clicks: optional(string()),
  actions: optional(array(actionSchema)),
  action_values: optional(array(actionSchema)),
  date_start: string(),
  [HOURLY]: optional(string()),
});

const pageSchema = object({
  data: array(insightSchema),
  paging: optional(
    object({ cursors: optional(object({ after: optional(string()) })), next: optional(string()) })
  ),
});

const accountSchema = object({ currency: string(), timezone_name: string() });

const errorSchema = object({
  error: object({
    message: string(),
    code: optional(number()),
    error_subcode: optional(number()),
    fbtrace_id: optional(string()),
  }),
});

type Insight = Infer<typeof insightSchema>;
type Action = Infer<typeof actionSchema>;

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  options: MetaAdPerformanceOptions,
  parse: (body: unknown) => T
): Promise<T> {
  const query = new URLSearchParams(params);
  if (options.appSecret) {
    query.set(
      'appsecret_proof',
      createHmac('sha256', options.appSecret).update(options.accessToken).digest('hex')
    );
  }
  const response = await fetch(`${GRAPH}/${path}?${query}`, {
    headers: { authorization: `Bearer ${options.accessToken}` },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = safeParse(errorSchema, body);
    const error = parsed.success ? parsed.data.error : undefined;
    throw new MetaAdsApiError(
      error?.message ?? `Meta Graph API responded ${response.status}`,
      response.status,
      error?.code,
      error?.error_subcode,
      error?.fbtrace_id
    );
  }
  return parse(body);
}

function parseWith<T>(schema: ZodMiniType<T>, what: string) {
  return (body: unknown): T => {
    const parsed = safeParse(schema, body);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const first = issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `Unexpected Meta ${what} response (${issues.length} issues): ${first}${issues.length > 3 ? '; …' : ''}`
      );
    }
    return parsed.data;
  };
}

function count(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

/** The action's total and its click-through part; nulls when Meta reported no such action. */
function conversion(actions: Action[] | undefined, actionType: string) {
  const action = actions?.find((a) => a.action_type === actionType);
  if (!action) return { total: null, click: null };
  return { total: Number(action.value ?? 0), click: Number(action[CLICK_WINDOW] ?? 0) };
}

/** `"13:00:00 - 13:59:59"` → 13. */
function hourOf(bucket: string | undefined): number {
  const hour = Number(bucket?.slice(0, 2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Unexpected Meta hourly bucket: ${bucket}`);
  }
  return hour;
}

function toRow(
  insight: Insight,
  accountId: string,
  currency: string,
  timeZone: string,
  actionType: string
): AdPerformanceRow {
  const start = zonedHourToUtc(insight.date_start, hourOf(insight[HOURLY]), timeZone);
  const conversions = conversion(insight.actions, actionType);
  const values = conversion(insight.action_values, actionType);
  return {
    platform: 'meta',
    account_id: accountId,
    campaign_id: insight.campaign_id,
    campaign_name: insight.campaign_name ?? null,
    ad_group_id: insight.adset_id ?? null,
    ad_group_name: insight.adset_name ?? null,
    ad_id: insight.ad_id,
    ad_name: insight.ad_name ?? null,
    channel: CHANNEL,
    medium: MEDIUM,
    channel_group: channelGroupOf(CHANNEL, MEDIUM),
    hour_start: start.toISOString(),
    currency,
    spend: Number(insight.spend ?? 0),
    impressions: count(insight.impressions),
    clicks: count(insight.inline_link_clicks),
    conversions: conversions.total,
    conversion_value: values.total,
    click_conversions: conversions.click,
    click_conversion_value: values.click,
  };
}

/**
 * Hourly delivery of every ad of the account that ran between `since` and `until` — deleted and
 * archived ads included — one row per ad and hour (hours without delivery are absent). The hours
 * are Meta's, in the account's time zone, turned into UTC instants. Conversions are those of each
 * ad's attribution setting (`use_unified_attribution_setting`), their click-through part from the
 * 7-day click window.
 *
 * Meta restates past hours as late conversions arrive — a purchase is credited to the hour of the
 * click, up to 7 days after it — and corrects spend for invalid traffic: re-fetch the last 8 days
 * daily (the 7-day window plus a day of time zone slack) and upsert on (`platform`, `account_id`,
 * `ad_id`, `hour_start`).
 *
 * @throws RangeError when `since` is more than 13 months back, where Meta keeps no hourly
 * breakdown and would answer with no rows rather than an error.
 */
export async function fetchMetaAdPerformance(
  options: MetaAdPerformanceOptions
): Promise<AdPerformanceRow[]> {
  const accountId = options.accountId.replace(/^act_/, '');
  const actionType = options.conversionActionType ?? 'purchase';

  const account = await graphGet(
    `act_${accountId}`,
    { fields: 'currency,timezone_name' },
    options,
    parseWith(accountSchema, 'ad account')
  );

  // Normalized, so `2025-9-8` compares as `2025-09-08`.
  const since = addDays(options.since, 0);
  const until = addDays(options.until, 0);
  const earliest = addMonths(todayIn(account.timezone_name), -HOURLY_RETENTION_MONTHS);
  if (since < earliest) {
    throw new RangeError(
      `Meta keeps hourly insights for ${HOURLY_RETENTION_MONTHS} months: since ${since} is before ${earliest}`
    );
  }

  const rows: AdPerformanceRow[] = [];
  for (let from = since; from <= until; from = addDays(from, CHUNK_DAYS)) {
    const last = addDays(from, CHUNK_DAYS - 1);
    const to = last < until ? last : until;
    let after: string | undefined;
    do {
      const params: Record<string, string> = {
        level: 'ad',
        fields: FIELDS.join(','),
        time_range: JSON.stringify({ since: from, until: to }),
        // One row per day. Without it the hourly breakdown folds the whole range into 24
        // hour-of-day buckets, all dated `since`.
        time_increment: '1',
        breakdowns: HOURLY,
        action_attribution_windows: JSON.stringify([CLICK_WINDOW, VIEW_WINDOW]),
        use_unified_attribution_setting: 'true',
        limit: '500',
      };
      if (after) params.after = after;
      const page = await graphGet(
        `act_${accountId}/insights`,
        params,
        options,
        parseWith(pageSchema, 'insights')
      );
      for (const insight of page.data) {
        rows.push(toRow(insight, accountId, account.currency, account.timezone_name, actionType));
      }
      // `next` is absent on the last page; the cursor alone is not a signal, Meta returns it there too.
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after);
  }

  return rows;
}
