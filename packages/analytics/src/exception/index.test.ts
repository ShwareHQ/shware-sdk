import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Integration } from '../third-parties/integration';

beforeEach(() => {
  vi.resetModules();
});

async function load(integrations: Integration[]) {
  const { baseOptions } = await import('../test/setup');
  const { setupAnalytics } = await import('../setup/index');
  setupAnalytics({ ...baseOptions(), integrations });
  return import('./index');
}

function integration(captureException?: Integration['captureException']): Integration {
  return { type: 'analytics', track: () => {}, captureException };
}

describe('captureException', () => {
  it('is a no-op before setupAnalytics', async () => {
    const { captureException } = await import('./index');
    expect(() => captureException(new Error('early'))).not.toThrow();
  });

  it('hands the error to every integration that tracks errors', async () => {
    const posthog = vi.fn<NonNullable<Integration['captureException']>>();
    const { captureException } = await load([integration(), integration(posthog)]);
    const error = new Error('request failed');

    captureException(error, { status: 500 });
    expect(posthog).toHaveBeenCalledWith(error, { status: 500 });
  });

  it('never throws, and a failing integration does not stop the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn<NonNullable<Integration['captureException']>>(() => {
      throw new Error('broken');
    });
    const next = vi.fn<NonNullable<Integration['captureException']>>();
    const { captureException } = await load([integration(failing), integration(next)]);

    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
