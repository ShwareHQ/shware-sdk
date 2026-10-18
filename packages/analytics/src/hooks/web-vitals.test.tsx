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
const { handlers } = vi.hoisted(() => {
  const handlers: Handlers = {};
  return { handlers };
});
vi.mock(import('web-vitals'), () => ({
  onCLS: (cb) => {
    handlers.CLS = cb;
  },
  onLCP: (cb) => {
    handlers.LCP = cb;
  },
  onINP: (cb) => {
    handlers.INP = cb;
  },
  onFCP: (cb) => {
    handlers.FCP = cb;
  },
  onTTFB: (cb) => {
    handlers.TTFB = cb;
  },
}));

beforeEach(() => {
  delete handlers.CLS;
  delete handlers.LCP;
  delete handlers.INP;
  delete handlers.FCP;
  delete handlers.TTFB;
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
});
