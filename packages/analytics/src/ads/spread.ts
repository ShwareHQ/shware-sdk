/**
 * Days as hours, for the platforms (or the stretches of their history) that report only days:
 * `AdPerformanceRow`s are hourly, so a day is spread evenly over its hours and the table never
 * mixes a day row with the hours inside it.
 */
import { addDays, zonedHourToUtc } from './time';
import type { AdPerformanceRow } from './types';

/** Decimal places of a day's numbers spread over its hours. */
const SPREAD_SCALE = 1e6;

/**
 * `value` in `parts` equal shares rounded to `SPREAD_SCALE`, the rounding left in the last share
 * so that the shares add back to `value` exactly as the platform reported it.
 */
export function spread(value: number, parts: number): number[] {
  const share = Math.round((value / parts) * SPREAD_SCALE) / SPREAD_SCALE;
  const last = Math.round((value - share * (parts - 1)) * SPREAD_SCALE) / SPREAD_SCALE;
  return [...Array.from({ length: parts - 1 }, () => share), last];
}

/**
 * A day row as one row per hour of the account's calendar day — 24, or 23 / 25 across a
 * daylight-saving change — each number spread evenly (nulls stay null).
 */
export function spreadDay(
  day: AdPerformanceRow,
  date: string,
  timeZone: string
): AdPerformanceRow[] {
  const start = zonedHourToUtc(date, 0, timeZone).getTime();
  const end = zonedHourToUtc(addDays(date, 1), 0, timeZone).getTime();
  const hours = Math.round((end - start) / 3_600_000);
  const shares = (value: number | null) => (value === null ? null : spread(value, hours));
  const spend = spread(day.spend, hours);
  const impressions = spread(day.impressions, hours);
  const clicks = spread(day.clicks, hours);
  const conversions = shares(day.conversions);
  const conversionValue = shares(day.conversion_value);
  const clickConversions = shares(day.click_conversions);
  const clickConversionValue = shares(day.click_conversion_value);
  return Array.from({ length: hours }, (_, hour) => ({
    ...day,
    hour_start: new Date(start + hour * 3_600_000).toISOString(),
    spend: spend[hour],
    impressions: impressions[hour],
    clicks: clicks[hour],
    conversions: conversions?.[hour] ?? null,
    conversion_value: conversionValue?.[hour] ?? null,
    click_conversions: clickConversions?.[hour] ?? null,
    click_conversion_value: clickConversionValue?.[hour] ?? null,
  }));
}
