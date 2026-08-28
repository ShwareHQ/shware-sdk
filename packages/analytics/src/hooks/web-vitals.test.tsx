// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';
import { useReportWebVitals } from './use-report-web-vitals';

const { handlers } = vi.hoisted(() => ({
  handlers: {} as Record<string, (metric: unknown) => void>,
}));

vi.mock('web-vitals', () => ({
  onCLS: (cb: (m: unknown) => void) => (handlers.CLS = cb),
  onLCP: (cb: (m: unknown) => void) => (handlers.LCP = cb),
  onINP: (cb: (m: unknown) => void) => (handlers.INP = cb),
  onFCP: (cb: (m: unknown) => void) => (handlers.FCP = cb),
  onTTFB: (cb: (m: unknown) => void) => (handlers.TTFB = cb),
}));

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key];
});

afterEach(() => {
  cleanup();
});

describe('useReportWebVitals', () => {
  it('subscribes the reporter to all five metrics and forwards them', () => {
    const report = vi.fn();
    function Page() {
      useReportWebVitals(report);
      return null;
    }
    render(<Page />);

    expect(Object.keys(handlers).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

    const metric = { name: 'LCP', value: 1234 } as Metric;
    handlers.LCP(metric);
    expect(report).toHaveBeenCalledWith(metric);
  });
});
