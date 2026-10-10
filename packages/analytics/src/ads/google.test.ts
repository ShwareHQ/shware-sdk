import { describe, expect, it } from 'vitest';
import { GoogleAdsReportError, parseGoogleAdsScriptReport } from './google';

const adGroupRow = {
  campaign_id: '23420060139',
  campaign_name: 'Search campaign',
  ad_group_id: '193094783173',
  ad_group_name: 'Competitors',
  date: '2026-10-09',
  hour: 23,
  cost_micros: '2920000',
  impressions: '3',
  clicks: '1',
  conversions: 0,
  conversion_value: 0,
};

const report = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  account_id: '114-774-9082',
  currency: 'USD',
  time_zone: 'America/Los_Angeles',
  rows,
  ...overrides,
});

describe('parseGoogleAdsScriptReport', () => {
  it('maps an ad group hour to the attribution vocabulary and a UTC instant', () => {
    expect(parseGoogleAdsScriptReport(report([adGroupRow]))).toEqual([
      {
        platform: 'google',
        account_id: '1147749082',
        campaign_id: '23420060139',
        campaign_name: 'Search campaign',
        ad_group_id: '193094783173',
        ad_group_name: 'Competitors',
        ad_id: '193094783173',
        ad_name: null,
        channel: 'google',
        medium: 'cpc',
        channel_group: 'paid_search',
        // 23:00 PDT (UTC-7) on the 9th.
        hour_start: '2026-10-10T06:00:00.000Z',
        currency: 'USD',
        spend: 2.92,
        impressions: 3,
        clicks: 1,
        conversions: 0,
        conversion_value: 0,
        click_conversions: 0,
        click_conversion_value: 0,
      },
    ]);
  });

  it('keys a Performance Max hour on its campaign, which has no ad group', () => {
    const [row] = parseGoogleAdsScriptReport(
      report([{ ...adGroupRow, ad_group_id: null, ad_group_name: null, campaign_id: '999' }])
    );
    expect(row).toMatchObject({ ad_group_id: null, ad_group_name: null, ad_id: '999' });
  });

  it('takes metrics as strings or numbers, absent spend as 0 and absent conversions as null', () => {
    const [row] = parseGoogleAdsScriptReport(
      report([
        {
          campaign_id: '1',
          date: '2026-10-09',
          hour: 5,
          impressions: 10,
          conversions: '1.5',
          conversion_value: 29,
        },
      ])
    );
    expect(row).toMatchObject({
      campaign_name: null,
      spend: 0,
      impressions: 10,
      clicks: 0,
      conversions: 1.5,
      conversion_value: 29,
      click_conversions: 1.5,
    });

    const [bare] = parseGoogleAdsScriptReport(
      report([{ campaign_id: '1', date: '2026-10-09', hour: 5 }])
    );
    expect(bare).toMatchObject({ conversions: null, conversion_value: null });
  });

  it('follows the zone across a daylight-saving change', () => {
    const rows = parseGoogleAdsScriptReport(
      report([
        { ...adGroupRow, date: '2026-11-01', hour: 0 },
        { ...adGroupRow, date: '2026-11-01', hour: 3 },
      ])
    );
    // PDT before 02:00 on 1 November, PST after.
    expect(rows.map((r) => r.hour_start)).toEqual([
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T11:00:00.000Z',
    ]);
  });

  it('rejects what is not a report', () => {
    expect(() => parseGoogleAdsScriptReport(null)).toThrow(GoogleAdsReportError);
    expect(() => parseGoogleAdsScriptReport(report([{ ...adGroupRow, hour: 24 }]))).toThrow(
      'rows.0: unexpected hour 2026-10-09 24'
    );
    expect(() =>
      parseGoogleAdsScriptReport(report([{ ...adGroupRow, date: '10/9/2026' }]))
    ).toThrow(GoogleAdsReportError);
    expect(() =>
      parseGoogleAdsScriptReport(report([{ ...adGroupRow, cost_micros: 'abc' }]))
    ).toThrow('rows.0.cost_micros: not a number: abc');
    expect(() => parseGoogleAdsScriptReport(report([], { time_zone: 'Nowhere/City' }))).toThrow(
      'Unknown time zone: Nowhere/City'
    );
  });
});
