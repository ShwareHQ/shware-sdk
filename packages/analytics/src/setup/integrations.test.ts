import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Integration } from '../third-parties/integration';

const fetchMock = vi.fn<typeof globalThis.fetch>();

function integration() {
  return {
    type: 'analytics' as const,
    track: vi.fn<Integration['track']>(),
    setUser: vi.fn<NonNullable<Integration['setUser']>>(),
  };
}

async function load(init: Record<string, unknown>) {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions } = await import('../test/setup');
  const setup = await import('./index');
  setup.setupAnalytics({ ...baseOptions(), ...init });
  const track = await import('../track/index');
  const visitor = await import('../visitor/index');
  return { config: setup.config, ...track, ...visitor };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('[]'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setupAnalytics({ integrations })', () => {
  it('hands each event and the signed-in user to every integration', async () => {
    const ga = integration();
    const meta = integration();
    const { track, identify } = await load({ integrations: [ga, meta] });

    track('sign_up', { method: 'email' });
    identify('u1', { email: 'a@b.co' });

    expect(ga.track).toHaveBeenCalledWith('sign_up', { method: 'email' }, expect.any(String));
    expect(meta.track).toHaveBeenCalledTimes(1);
    expect(meta.setUser).toHaveBeenCalledWith({ user_id: 'u1', user_data: { email: 'a@b.co' } });
  });
});

describe('excludeFromIntegrations', () => {
  it('reach no browser tracker but are still sent to the server', async () => {
    vi.useFakeTimers();
    const ga = integration();
    const { track } = await load({ integrations: [ga], excludeFromIntegrations: ['purchase'] });

    track('purchase', { value: 9, currency: 'USD', transaction_id: 'cs_1', items: [] });
    track('sign_up', { method: 'email' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(ga.track.mock.calls.map(([name]) => name)).toEqual(['sign_up']);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { name: string }[];
    expect(body.map((e) => e.name)).toContain('purchase');
    vi.useRealTimers();
  });
});
