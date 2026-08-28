import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

async function load() {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, jsonResponse } = await import('../test/setup');
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions());
  const link = await import('./index');
  return { jsonResponse, ...link };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLink', () => {
  it('resolves the link', async () => {
    const { getLink, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'l1', utm_source: 'newsletter' }));

    await expect(getLink('l1')).resolves.toMatchObject({ utm_source: 'newsletter' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/links/l1', expect.anything());
  });

  it('answers null for a rejected lookup', async () => {
    const { getLink, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse('missing', 404));
    await expect(getLink('gone')).resolves.toBeNull();
  });

  it('answers null for a network failure, after the retry wrapper gives up', async () => {
    vi.useFakeTimers();
    const { getLink } = await load();
    fetchMock.mockRejectedValue(new Error('offline'));

    const pending = getLink('gone');
    await vi.advanceTimersByTimeAsync(10_000); // ride out the retry backoff
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe('createLink', () => {
  it('resolves the created link', async () => {
    const { createLink, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'l1', utm_source: 'newsletter' }));

    await expect(
      createLink({
        url: 'https://x.test',
        utm_source: 'newsletter',
        utm_medium: 'email',
        utm_campaign: 'spring',
      })
    ).resolves.toMatchObject({ id: 'l1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/links',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws on a rejected creation', async () => {
    const { createLink, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse('bad request', 400));

    await expect(createLink({ url: 'https://x.test' } as never)).rejects.toThrow(
      'Failed to create link'
    );
  });
});
