import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Tracking from '../track/index';

const { track, sendBeacon, sendPendingEvents } = vi.mockObject<
  Pick<typeof Tracking, 'track' | 'sendBeacon' | 'sendPendingEvents'>
>({ track() {}, sendBeacon() {}, sendPendingEvents() {} });
vi.mock<Pick<typeof Tracking, 'track' | 'sendBeacon' | 'sendPendingEvents'>>(
  import('../track/index'),
  () => ({ track, sendBeacon, sendPendingEvents })
);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/a');
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://outside.example/landing');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function load(native: boolean) {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { baseOptions, memoryStorage } = await import('../test/setup');
  const { setupAnalytics } = await import('../setup/index');
  setupAnalytics(baseOptions({ storage: memoryStorage(), platform: native ? 'ios' : 'web' }));
  const { getSession } = await import('../setup/session');
  const session = getSession();
  session.pageshow();
  session.visibilitychange('visible');
  session.focus();
  session.flush();
  const flush = vi.spyOn(session, 'flush');
  const { App, compilerReports } = await import('../test/compiler/app.test');
  return { App, compilerReports, flush, advance: (ms: number) => (now += ms) };
}

it('compiles the actual hooks and caller, including the parent cache that can skip a Page render', async () => {
  const { compilerReports } = await load(false);
  expect(compilerReports).toHaveLength(3);
  for (const [file, names] of [
    ['use-web-analytics.ts', ['useWebAnalytics']],
    ['use-app-analytics.ts', ['useAppAnalytics']],
    ['app.test.tsx', ['WebPage', 'NativeScreen', 'App']],
  ] as const) {
    const report = compilerReports.find((item) => item.file === file);
    expect(report?.events).toEqual(
      names.map((name) => expect.objectContaining({ kind: 'CompileSuccess', name }))
    );
  }
  const caller = compilerReports.find((report) => report.file === 'app.test.tsx');
  // This is the important compiler optimization: changing only Activity's mode reuses Page's
  // JSX rather than rendering it to refresh a render-time usePrevious snapshot.
  expect(caller?.code).toMatch(
    /if \([^\n]*pathname[^\n]*\) \{\s+\w+ = <Page pathname=\{pathname\} search=\{search\} \/>;[\s\S]*?else \{\s+\w+ = \$\[\d+\];/
  );
});

describe.each([
  {
    platform: 'web',
    native: false,
    event: 'page_view',
    current: 'page_path',
    previous: 'previous_page_path',
  },
  {
    platform: 'native',
    native: true,
    event: 'screen_view',
    current: 'screen_name',
    previous: 'previous_screen_class',
  },
])('React Compiler $platform analytics', ({ native, event, current, previous }) => {
  it.each([false, true])(
    'restores a cached Activity child with its last queued view (navigated: %s)',
    async (navigate) => {
      const { App, flush, advance } = await load(native);
      const view = render(<App native={native} />);
      if (navigate) act(() => view.getByText('Navigate B').click());
      const pathname = navigate ? '/b' : '/a';
      const { getTags } = await import('../web/index');
      const before = await getTags();
      act(() => view.getByText('Hide').click());
      track.mockClear();
      flush.mockClear();
      advance(1234);
      act(() => view.getByText('Reveal').click());

      const referrer = navigate ? `${window.location.origin}/a` : 'https://outside.example/landing';
      expect(track.mock.calls.filter(([name]) => name === event)).toEqual([
        [
          event,
          expect.objectContaining({
            [current]: pathname,
            [previous]: pathname,
            engagement_time_msec: 1234,
            ...(native ? {} : { page_location: window.location.href, page_referrer: referrer }),
          }),
        ],
      ]);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(await getTags()).toMatchObject({
        page_load_id: before.page_load_id,
        page_referrer: native ? before.page_referrer : referrer,
      });
    }
  );

  it('uses the last queued view through A → B → C → back B → back A', async () => {
    const { App, flush, advance } = await load(native);
    const view = render(<App native={native} />);
    advance(1000);
    act(() => view.getByText('Navigate B').click());
    advance(1000);
    act(() => view.getByText('Navigate C').click());
    for (const pathname of ['/b', '/a']) {
      advance(1000);
      const navigated = new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
      });
      await act(async () => {
        view.getByText('Back').click();
        await navigated;
      });
      expect(window.location.pathname).toBe(pathname);
    }

    expect(track.mock.calls.filter(([name]) => name === event)).toEqual(
      [
        ['/a', undefined, undefined, 'https://outside.example/landing'],
        ['/b', '/a', 1000, `${window.location.origin}/a`],
        ['/c', '/b', 1000, `${window.location.origin}/b`],
        ['/b', '/c', 1000, `${window.location.origin}/c`],
        ['/a', '/b', 1000, `${window.location.origin}/b`],
      ].map(([pathname, predecessor, engagement, referrer]) => [
        event,
        expect.objectContaining({
          [current]: pathname,
          [previous]: predecessor,
          engagement_time_msec: engagement,
          ...(native ? {} : { page_referrer: referrer }),
        }),
      ])
    );
    expect(flush).toHaveBeenCalledTimes(4);
  });

  it('reports the first queued view as predecessor when StrictMode replays the effect', async () => {
    const { App, flush } = await load(native);
    render(
      <StrictMode>
        <App native={native} />
      </StrictMode>
    );
    expect(track.mock.calls.filter(([name]) => name === event)).toEqual([
      [
        event,
        expect.objectContaining({
          [current]: '/a',
          [previous]: undefined,
          engagement_time_msec: undefined,
        }),
      ],
      [
        event,
        expect.objectContaining({ [current]: '/a', [previous]: '/a', engagement_time_msec: 0 }),
      ],
    ]);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
