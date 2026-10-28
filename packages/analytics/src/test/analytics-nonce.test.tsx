// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Analytics as NextAnalytics } from '../next/index';
import { Analytics as ReactRouterAnalytics } from '../react-router/index';
import { Analytics as TanstackAnalytics } from '../tanstack/analytics';

// The components are thin composition over hooks tested elsewhere; only their markup matters here.
vi.mock(import('../track/index'), () => ({ track: () => {} }) as never);
vi.mock(import('../hooks/use-web-analytics'), () => ({ useWebAnalytics: () => {} }));
vi.mock(import('../hooks/use-outbound-click-analytics'), () => ({
  useOutboundClickAnalytics: () => {},
}));
vi.mock(import('../hooks/use-uet-id-sync'), () => ({ useUETIdSync: () => {} }));
vi.mock(import('../hooks/use-report-web-vitals'), () => ({ useReportWebVitals: () => {} }));
vi.mock(import('@tanstack/react-router'), () => ({
  useLocation: (() => ({ pathname: '/', searchStr: '' })) as never,
}));
vi.mock(import('react-router'), () => ({
  useLocation: (() => ({ pathname: '/', search: '' })) as never,
}));
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

const pixels = {
  gaId: 'G-TEST123',
  metaPixelId: '1234567890',
  redditPixelId: 'a2_test',
  linkedInPartnerId: '123',
  uetTagId: '456',
  hotjarId: '789',
} as const;

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

const expectedIds = [
  'gtag',
  'gtag-init',
  'meta-pixel',
  'reddit-pixel',
  'linkedin-insight-tag',
  'uet-tag',
  'hotjar',
];

describe('Analytics nonce', () => {
  it.each([
    [
      'tanstack',
      () => (
        <TanstackAnalytics
          nonce={NONCE}
          {...pixels}
          gaSrc="/tanstack/gtag.js"
          openaiPixelId="oai_test"
        />
      ),
      [...expectedIds, 'openai-pixel'],
    ],
    [
      'react-router',
      () => <ReactRouterAnalytics nonce={NONCE} {...pixels} gaSrc="/react-router/gtag.js" />,
      expectedIds,
    ],
    ['next', () => <NextAnalytics nonce={NONCE} {...pixels} gaSrc="/next/gtag.js" />, expectedIds],
  ])('%s puts the nonce on every script', (_, element, ids) => {
    render(element());
    const found = scripts();
    expect(found.map((s) => s.id).sort(byName)).toEqual([...ids].sort(byName));
    expect(found.filter((s) => s.nonce !== NONCE)).toEqual([]);
  });

  it('no longer accepts gtmId', () => {
    expectTypeOf<ComponentProps<typeof TanstackAnalytics>>().not.toHaveProperty('gtmId');
    expectTypeOf<ComponentProps<typeof ReactRouterAnalytics>>().not.toHaveProperty('gtmId');
    expectTypeOf<ComponentProps<typeof NextAnalytics>>().not.toHaveProperty('gtmId');
  });
});
