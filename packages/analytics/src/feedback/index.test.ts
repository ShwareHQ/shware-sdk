import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

async function load() {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, jsonResponse } = await import('../test/setup');
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions());
  const feedback = await import('./index');
  return { jsonResponse, ...feedback };
}

const dto = { name: 'Ada', email: 'ada@example.com', message: 'Love it' };

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendFeedback', () => {
  it('POSTs the feedback to the configured endpoint', async () => {
    const { sendFeedback, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse({}));

    await sendFeedback(dto);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/feedback');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(dto);
  });

  it('throws with the status and body when the server rejects it', async () => {
    const { sendFeedback, jsonResponse } = await load();
    fetchMock.mockResolvedValue(jsonResponse('nope', 422));

    await expect(sendFeedback(dto)).rejects.toThrow('Failed to send feedback: 422');
  });
});
