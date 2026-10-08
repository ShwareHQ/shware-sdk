import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAdsApiError, fetchMetaAdPerformance } from './meta';

const options = {
  accessToken: 'token-1',
  accountId: 'act_42',
  since: '2026-10-01',
  until: '2026-10-02',
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function insight(overrides: Record<string, unknown> = {}) {
  return {
    ad_id: 'ad-1',
    ad_name: 'Ad one',
    adset_id: 'set-1',
    adset_name: 'Set one',
    campaign_id: 'camp-1',
    campaign_name: 'Campaign one',
    spend: '12.34',
    impressions: '1000',
    inline_link_clicks: '7',
    date_start: '2026-10-01',
    date_stop: '2026-10-01',
    hourly_stats_aggregated_by_advertiser_time_zone: '13:00:00 - 13:59:59',
    ...overrides,
  };
}

function mockGraph(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URL and init of the `index`-th request the mock received. */
function request(fetchMock: ReturnType<typeof mockGraph>, index: number) {
  const call = fetchMock.mock.calls.at(index);
  if (!call) throw new Error(`no request #${index}`);
  const [input, init] = call;
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return { href, url: new URL(href), headers: new Headers(init?.headers) };
}

const account = (timezone_name = 'UTC') => json({ currency: 'USD', timezone_name, id: 'act_42' });

beforeEach(() => {
  // Only the clock: the retention check reads today, the mocked fetch must still resolve.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchMetaAdPerformance', () => {
  it('maps an hourly ad row to the attribution vocabulary and a UTC period', async () => {
    mockGraph(account(), json({ data: [insight()] }));

    const [row] = await fetchMetaAdPerformance(options);

    expect(row).toEqual({
      platform: 'meta',
      account_id: '42',
      campaign_id: 'camp-1',
      campaign_name: 'Campaign one',
      ad_group_id: 'set-1',
      ad_group_name: 'Set one',
      ad_id: 'ad-1',
      ad_name: 'Ad one',
      channel: 'meta',
      medium: 'cpc',
      channel_group: 'paid_social',
      hour_start: '2026-10-01T13:00:00.000Z',
      currency: 'USD',
      spend: 12.34,
      impressions: 1000,
      clicks: 7,
      conversions: null,
      conversion_value: null,
      click_conversions: null,
      click_conversion_value: null,
    });
  });

  it('places the hour in the account time zone', async () => {
    mockGraph(account('America/Los_Angeles'), json({ data: [insight()] }));

    const [row] = await fetchMetaAdPerformance(options);

    // 13:00 in Los Angeles on 1 October (PDT, UTC-7) is 20:00 UTC.
    expect(row.hour_start).toBe('2026-10-01T20:00:00.000Z');
  });

  it('counts the conversion action, total and click-through apart', async () => {
    mockGraph(
      account(),
      json({
        data: [
          insight({
            actions: [
              { action_type: 'link_click', value: '7' },
              { action_type: 'purchase', value: '3', '7d_click': '1', '1d_view': '2' },
            ],
            action_values: [{ action_type: 'purchase', value: '129.5', '7d_click': '29' }],
          }),
        ],
      })
    );

    const [row] = await fetchMetaAdPerformance(options);

    expect(row).toMatchObject({
      conversions: 3,
      conversion_value: 129.5,
      click_conversions: 1,
      click_conversion_value: 29,
    });
  });

  it('counts a conversion outside the ad attribution setting as none, its windows still read', async () => {
    mockGraph(
      account(),
      json({ data: [insight({ actions: [{ action_type: 'purchase', '1d_view': '1' }] })] })
    );

    const [row] = await fetchMetaAdPerformance(options);

    expect(row).toMatchObject({ conversions: 0, click_conversions: 0 });
  });

  it('reads another action type when asked, and a view-only conversion has no click part', async () => {
    mockGraph(
      account(),
      json({
        data: [
          insight({
            actions: [{ action_type: 'complete_registration', value: '2', '1d_view': '2' }],
          }),
        ],
      })
    );

    const [row] = await fetchMetaAdPerformance({
      ...options,
      conversionActionType: 'complete_registration',
    });

    expect(row.conversions).toBe(2);
    expect(row.click_conversions).toBe(0);
    expect(row.conversion_value).toBeNull();
  });

  it('asks for hourly ad rows per day, each ad attribution setting, with the token in a header', async () => {
    const fetchMock = mockGraph(account(), json({ data: [] }));

    await fetchMetaAdPerformance(options);

    expect(request(fetchMock, 0).href).toMatch(/\/act_42\?fields=currency%2Ctimezone_name$/);

    const { url } = request(fetchMock, 1);
    expect(url.pathname).toMatch(/\/act_42\/insights$/);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      level: 'ad',
      time_increment: '1',
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
      time_range: JSON.stringify({ since: '2026-10-01', until: '2026-10-02' }),
      action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
      use_unified_attribution_setting: 'true',
    });
    for (const index of [0, 1]) {
      expect(request(fetchMock, index).headers.get('authorization')).toBe('Bearer token-1');
      expect(request(fetchMock, index).href).not.toContain('token-1');
    }
  });

  it('rejects an hourly row without its hour', async () => {
    const { hourly_stats_aggregated_by_advertiser_time_zone: _, ...day } = insight();
    mockGraph(account(), json({ data: [day] }));

    await expect(fetchMetaAdPerformance(options)).rejects.toThrow(/hourly bucket/);
  });

  it('reads back to the 13 months Meta keeps hourly, and throws before them', async () => {
    mockGraph(account(), json({ data: [] }));
    await expect(
      fetchMetaAdPerformance({ ...options, since: '2025-09-08', until: '2025-09-08' })
    ).resolves.toEqual([]);

    const fetchMock = mockGraph(account());
    await expect(
      fetchMetaAdPerformance({ ...options, since: '2025-09-07', until: '2025-09-07' })
    ).rejects.toThrow(RangeError);
    // Thrown before asking for insights Meta would answer with nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('splits a long range into windows Meta answers synchronously', async () => {
    const fetchMock = mockGraph(
      account(),
      json({ data: [insight({ ad_id: 'ad-1' })] }),
      json({ data: [insight({ ad_id: 'ad-2', date_start: '2026-09-01' })] })
    );

    const rows = await fetchMetaAdPerformance({
      ...options,
      since: '2026-09-01',
      until: '2026-09-10',
    });

    expect(rows.map((r) => r.ad_id)).toEqual(['ad-1', 'ad-2']);
    const ranges = [1, 2].map((i) => request(fetchMock, i).url.searchParams.get('time_range'));
    expect(ranges).toEqual([
      JSON.stringify({ since: '2026-09-01', until: '2026-09-07' }),
      JSON.stringify({ since: '2026-09-08', until: '2026-09-10' }),
    ]);
  });

  it('compares unpadded dates as dates', async () => {
    mockGraph(account());

    await expect(
      fetchMetaAdPerformance({ ...options, since: '2025-9-7', until: '2025-9-7' })
    ).rejects.toThrow('since 2025-09-07 is before 2025-09-08');
  });

  it('follows the after cursor while Meta says there is a next page', async () => {
    const fetchMock = mockGraph(
      account(),
      json({
        data: [insight({ ad_id: 'ad-1' })],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.facebook.com/next' },
      }),
      json({ data: [insight({ ad_id: 'ad-2' })], paging: { cursors: { after: 'cursor-3' } } })
    );

    const rows = await fetchMetaAdPerformance(options);

    expect(rows.map((r) => r.ad_id)).toEqual(['ad-1', 'ad-2']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(request(fetchMock, 2).url.searchParams.get('after')).toBe('cursor-2');
  });

  it('signs requests with appsecret_proof when given the app secret', async () => {
    const fetchMock = mockGraph(account(), json({ data: [] }));

    await fetchMetaAdPerformance({ ...options, appSecret: 'secret' });

    const { url } = request(fetchMock, 0);
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    expect([...url.searchParams.values()]).not.toContain('secret');
  });

  it('throws the Graph API error with its codes', async () => {
    mockGraph(
      json(
        {
          error: {
            message: 'Invalid OAuth access token.',
            type: 'OAuthException',
            code: 190,
            error_subcode: 463,
            fbtrace_id: 'trace-1',
          },
        },
        400
      )
    );

    const error = await fetchMetaAdPerformance(options).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MetaAdsApiError);
    expect(error).toMatchObject({
      message: 'Invalid OAuth access token.',
      status: 400,
      code: 190,
      subcode: 463,
      fbtraceId: 'trace-1',
    });
  });

  it('rejects a response that does not have the expected shape', async () => {
    mockGraph(account(), json({ data: [{ ad_id: 'ad-1' }] }));

    await expect(fetchMetaAdPerformance(options)).rejects.toThrow(/Unexpected Meta insights/);
  });
});
