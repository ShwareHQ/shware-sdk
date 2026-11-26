import { describe, expect, it } from 'vitest';
import { MicrosoftAdsReportError, parseMicrosoftAdsScriptReport } from './microsoft';
import type { AdPerformanceRow } from './types';

const adGroupDay = {
  campaign_id: 524178203,
  campaign_name: 'Sales_Search_US_Virtual Staging',
  ad_group_id: '1307418283920468',
  ad_group_name: 'AI Virtual Staging - Competitors',
  date: '2026-11-18',
  spend: 48,
  impressions: 960,
  clicks: 12,
  conversions: 1,
  revenue: 26.1,
};

const report = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  account_id: 188443496,
  currency: 'USD',
  time_zone: 'America/Los_Angeles',
  rows,
  ...overrides,
});

const sum = (
  rows: AdPerformanceRow[],
  key: 'spend' | 'clicks' | 'conversions' | 'conversion_value'
) => Math.round(rows.reduce((n, r) => n + (r[key] ?? 0), 0) * 1e6) / 1e6;

describe('parseMicrosoftAdsScriptReport', () => {
  it('spreads an ad group day over the hours of the account’s day', () => {
    const rows = parseMicrosoftAdsScriptReport(report([adGroupDay]));
    expect(rows).toHaveLength(24);
    expect(rows[0]).toEqual({
      platform: 'microsoft',
      account_id: '188443496',
      campaign_id: '524178203',
      campaign_name: 'Sales_Search_US_Virtual Staging',
      ad_group_id: '1307418283920468',
      ad_group_name: 'AI Virtual Staging - Competitors',
      ad_id: '1307418283920468',
      ad_name: null,
      channel: 'microsoft',
      medium: 'cpc',
      channel_group: 'paid_search',
      // Midnight in Los Angeles (PST).
      hour_start: '2026-11-18T08:00:00.000Z',
      currency: 'USD',
      spend: 2,
      impressions: 40,
      clicks: 0.5,
      conversions: 0.041667,
      conversion_value: 1.0875,
      click_conversions: 0.041667,
      click_conversion_value: 1.0875,
    });
    expect(rows.at(-1)?.hour_start).toBe('2026-11-19T07:00:00.000Z');
    expect(sum(rows, 'spend')).toBe(48);
    expect(sum(rows, 'conversions')).toBe(1);
    expect(sum(rows, 'conversion_value')).toBe(26.1);
  });

  it('gives the day a daylight-saving change ends 25 hours', () => {
    const rows = parseMicrosoftAdsScriptReport(report([{ ...adGroupDay, date: '2026-11-01' }]));
    expect(rows).toHaveLength(25);
    expect(sum(rows, 'clicks')).toBe(12);
  });

  it('keeps a missing conversion count null', () => {
    const { conversions: _, revenue: __, ...noConversions } = adGroupDay;
    const [row] = parseMicrosoftAdsScriptReport(report([noConversions]));
    expect(row).toMatchObject({ conversions: null, conversion_value: null, spend: 2 });
  });

  it('refuses a body that is not a report', () => {
    expect(() => parseMicrosoftAdsScriptReport({ rows: [] })).toThrow(MicrosoftAdsReportError);
    expect(() =>
      parseMicrosoftAdsScriptReport(report([{ ...adGroupDay, date: '11/18/2026' }]))
    ).toThrow(MicrosoftAdsReportError);
    expect(() => parseMicrosoftAdsScriptReport(report([], { time_zone: 'Mars/Base' }))).toThrow(
      MicrosoftAdsReportError
    );
    expect(() => parseMicrosoftAdsScriptReport(report([{ ...adGroupDay, spend: 'lots' }]))).toThrow(
      MicrosoftAdsReportError
    );
  });
});
