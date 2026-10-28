// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Vitals from 'web-vitals';
import { useReportWebVitals } from './use-report-web-vitals';

type Handlers = {
  CLS?: Parameters<typeof Vitals.onCLS>[0];
  LCP?: Parameters<typeof Vitals.onLCP>[0];
  INP?: Parameters<typeof Vitals.onINP>[0];
  FCP?: Parameters<typeof Vitals.onFCP>[0];
  TTFB?: Parameters<typeof Vitals.onTTFB>[0];
};
const { handlers, subscriptions } = vi.hoisted(() => {
  const handlers: Handlers = {};
  const subscriptions = { CLS: 0, LCP: 0, INP: 0, FCP: 0, TTFB: 0 };
  return { handlers, subscriptions };
});
vi.mock(import('web-vitals'), () => ({
  onCLS: (cb) => {
    subscriptions.CLS += 1;
    handlers.CLS = cb;
  },
  onLCP: (cb) => {
    subscriptions.LCP += 1;
    handlers.LCP = cb;
  },
  onINP: (cb) => {
    subscriptions.INP += 1;
    handlers.INP = cb;
  },
  onFCP: (cb) => {
    subscriptions.FCP += 1;
    handlers.FCP = cb;
  },
  onTTFB: (cb) => {
    subscriptions.TTFB += 1;
    handlers.TTFB = cb;
  },
}));

const lcp: Vitals.LCPMetric = {
  name: 'LCP',
  value: 1234,
  delta: 1234,
  rating: 'good',
  id: 'test-lcp',
  entries: [],
  navigationType: 'navigate',
  navigationId: 1,
};

beforeEach(() => {
  delete handlers.CLS;
  delete handlers.LCP;
  delete handlers.INP;
  delete handlers.FCP;
  delete handlers.TTFB;
  for (const key of Object.keys(subscriptions) as (keyof typeof subscriptions)[]) {
    subscriptions[key] = 0;
  }
});

afterEach(() => {
  cleanup();
});

describe('useReportWebVitals', () => {
  it('subscribes the reporter to all five metrics and forwards them', () => {
    const report = vi.fn<Parameters<typeof useReportWebVitals>[0]>();
    function Page() {
      useReportWebVitals(report);
      return null;
    }
    render(<Page />);

    expect(Object.keys(handlers).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

    const metric: Vitals.LCPMetric = {
      name: 'LCP',
      value: 1234,
      delta: 1234,
      rating: 'good',
      id: 'test-lcp',
      entries: [],
      navigationType: 'navigate',
      navigationId: 1,
    };
    expect(handlers.LCP).toBeDefined();
    if (!handlers.LCP) throw new Error('LCP handler was not registered');
    handlers.LCP(metric);
    expect(report).toHaveBeenCalledWith(metric);
  });

  it('subscribes once across re-renders and forwards to the latest callback', () => {
    const calls: string[] = [];
    // Mirrors `Analytics`: re-renders on every navigation with a fresh inline callback.
    function Page({ pathname }: { pathname: string }) {
      useReportWebVitals((metric) => calls.push(`${pathname}:${metric.name}`));
      return null;
    }
    const { rerender } = render(<Page pathname="/a" />);
    rerender(<Page pathname="/b" />);
    rerender(<Page pathname="/c" />);

    expect(subscriptions).toEqual({ CLS: 1, LCP: 1, INP: 1, FCP: 1, TTFB: 1 });

    if (!handlers.LCP) throw new Error('LCP handler was not registered');
    handlers.LCP(lcp);
    expect(calls).toEqual(['/c:LCP']);
  });
});
