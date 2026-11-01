// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Analytics as NextAnalytics } from '../next/index';
import { Analytics as ReactAnalytics } from '../react/index';
import {
  googleAnalytics,
  linkedInAds,
  metaAds,
  microsoftAds,
  openaiAds,
  posthogAnalytics,
  redditAds,
} from '../third-parties/index';

// The components are thin composition over hooks tested elsewhere; only their markup matters here.
vi.mock(import('../track/index'), () => ({ track: () => {} }) as never);
vi.mock(import('../hooks/use-web-analytics'), () => ({ useWebAnalytics: () => {} }));
vi.mock(import('../hooks/use-outbound-click-analytics'), () => ({
  useOutboundClickAnalytics: () => {},
}));
vi.mock(import('../hooks/use-uet-id-sync'), () => ({ useUETIdSync: () => {} }));
vi.mock(import('../hooks/use-report-web-vitals'), () => ({ useReportWebVitals: () => {} }));
vi.mock(import('next/navigation'), () => ({
  usePathname: () => '/',
  useSearchParams: (() => new URLSearchParams()) as never,
}));
vi.mock(import('next/web-vitals'), () => ({ useReportWebVitals: () => {} }));
// next/script injects scripts from an effect on the client and renders nothing on the server, so
// render its props as a plain tag: what is under test is that the component forwards `nonce`.
vi.mock(import('next/script'), () => ({
  default: (({
    strategy: _strategy,
    ...props
  }: ComponentProps<'script'> & { strategy?: string }) => <script {...props} />) as never,
}));

const NONCE = 'r4nd0m-n0nce';

// A distinct `gaSrc` per case: React dedupes async scripts by `src` for the document's lifetime.
function integrations(gaSrc: string) {
  return [
    googleAnalytics({ id: 'G-TEST123', src: gaSrc }),
    metaAds({ pixelId: '1234567890' }),
    redditAds({ pixelId: 'a2_test' }),
    linkedInAds({ partnerId: '123', conversions: {} }),
    microsoftAds({ tagId: '456' }),
  ];
}

// React 19 hoists `async` external scripts into <head>, so read the whole document. It also
// dedupes them by `src` for the document's lifetime, hence a distinct `gaSrc` per case.
function scripts() {
  return [...document.querySelectorAll('script')].map((script) => ({
    id: script.id,
    nonce: script.getAttribute('nonce'),
  }));
}

const byName = (a: string, b: string) => a.localeCompare(b);

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
});

const expectedIds = ['gtag', 'meta-pixel', 'reddit-pixel', 'linkedin-insight-tag', 'uet-tag'];

describe('Analytics nonce', () => {
  it.each([
    [
      'react',
      () => (
        <ReactAnalytics
          pathname="/"
          search=""
          nonce={NONCE}
          integrations={[...integrations('/react/gtag.js'), openaiAds({ pixelId: 'oai_test' })]}
        />
      ),
      [...expectedIds, 'openai-pixel'],
    ],
    [
      'next',
      () => <NextAnalytics nonce={NONCE} integrations={integrations('/next/gtag.js')} />,
      expectedIds,
    ],
  ])('%s puts the nonce on every script', (_, element, ids) => {
    render(element());
    const found = scripts();
    expect(found.map((s) => s.id).sort(byName)).toEqual([...ids].sort(byName));
    expect(found.filter((s) => s.nonce !== NONCE)).toEqual([]);
  });

  it('takes the platform ids from integrations only', () => {
    expectTypeOf<ComponentProps<typeof ReactAnalytics>>().not.toHaveProperty('gaId');
    expectTypeOf<ComponentProps<typeof NextAnalytics>>().not.toHaveProperty('uetTagId');
  });

  it('no longer accepts gtmId', () => {
    expectTypeOf<ComponentProps<typeof ReactAnalytics>>().not.toHaveProperty('gtmId');
    expectTypeOf<ComponentProps<typeof NextAnalytics>>().not.toHaveProperty('gtmId');
  });
});

describe('Analytics preconnect', () => {
  // React dedupes hints by origin for the document's lifetime, hence a region per case.
  const posthog = (region: string) =>
    posthogAnalytics({
      token: 'phc_test',
      config: { api_host: `https://${region}.i.posthog.com` },
    });
  const preconnects = () =>
    [...document.querySelectorAll('link[rel="preconnect"]')].map((link) =>
      link.getAttribute('href')
    );

  it.each([
    ['react', 'us', () => <ReactAnalytics pathname="/" search="" integrations={[posthog('us')]} />],
    ['next', 'eu', () => <NextAnalytics integrations={[posthog('eu')]} />],
  ])("%s preconnects to the integrations' origins", (_, region, element) => {
    render(element());
    expect(preconnects()).toEqual([`https://${region}-assets.i.posthog.com`]);
  });
});
