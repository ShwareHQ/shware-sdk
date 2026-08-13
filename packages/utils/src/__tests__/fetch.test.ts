import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '../fetch';

function mockFetch(responses: Array<Response | Error>) {
  const spy = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) spy.mockRejectedValueOnce(response);
    else spy.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', spy);
  return spy;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should not retry a successful response', async () => {
    const spy = mockFetch([json({ ok: true })]);
    const response = await fetch('https://example.com', { delayFactor: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('should retry 408, 429 and 5xx by default', async () => {
    for (const status of [408, 429, 500, 503]) {
      const spy = mockFetch([json({}, status), json({ ok: true })]);
      const response = await fetch('https://example.com', { delayFactor: 0 });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
      vi.unstubAllGlobals();
    }
  });

  it('should not retry other error statuses by default', async () => {
    const spy = mockFetch([json({}, 400)]);
    const response = await fetch('https://example.com', { delayFactor: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
  });

  it('should call a custom condition for successful responses', async () => {
    const spy = mockFetch([json({}), json({})]);
    const retryCondition = vi.fn<(response: Response) => boolean>().mockReturnValueOnce(true);

    await fetch('https://example.com', { delayFactor: 0, retryCondition });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(retryCondition).toHaveBeenCalledTimes(2);
    expect(retryCondition.mock.calls[0]?.[0].status).toBe(200);
  });

  it('should await an async condition that reads the body', async () => {
    const spy = mockFetch([json({ status: 'FAILED' }), json({ status: 'COMPLETED' })]);
    const response = await fetch('https://example.com', {
      delayFactor: 0,
      retryCondition: async (response) => {
        const data = (await response.json()) as { status: string };
        return data.status === 'FAILED';
      },
    });

    expect(spy).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ status: 'COMPLETED' });
  });

  it('should leave the returned body unread after the condition consumed its clone', async () => {
    mockFetch([json({ status: 'FAILED' })]);
    const response = await fetch('https://example.com', {
      retries: 0,
      delayFactor: 0,
      retryCondition: async (response) => {
        await response.json();
        return true;
      },
    });

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ status: 'FAILED' });
  });

  it('should leave the returned body unread when the condition ignores its clone', async () => {
    mockFetch([json({ ok: true })]);
    const response = await fetch('https://example.com', {
      delayFactor: 0,
      retryCondition: () => false,
    });

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('should handle a condition on a response without a body', async () => {
    mockFetch([new Response(null, { status: 204 })]);
    const retryCondition = vi.fn<(response: Response) => boolean>().mockReturnValue(false);

    const response = await fetch('https://example.com', { delayFactor: 0, retryCondition });

    expect(response.status).toBe(204);
    expect(retryCondition).toHaveBeenCalledTimes(1);
  });

  it('should return the last response when retries are exhausted', async () => {
    const spy = mockFetch([json({}, 500), json({}, 500), json({}, 500)]);
    const response = await fetch('https://example.com', { retries: 2, delayFactor: 0 });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(500);
  });

  it('should not call the condition on the last attempt', async () => {
    mockFetch([json({}, 500), json({}, 500)]);
    const retryCondition = vi.fn<(response: Response) => boolean>().mockReturnValue(true);

    await fetch('https://example.com', { retries: 1, delayFactor: 0, retryCondition });

    expect(retryCondition).toHaveBeenCalledTimes(1);
  });

  it('should propagate an error thrown by the condition', async () => {
    mockFetch([json({}), json({})]);
    const error = new Error('bad body');

    await expect(
      fetch('https://example.com', {
        delayFactor: 0,
        retryCondition: () => {
          throw error;
        },
      })
    ).rejects.toBe(error);
  });

  it('should retry network errors and throw the last one', async () => {
    const error = new Error('network down');
    const spy = mockFetch([new Error('network down'), error]);

    await expect(fetch('https://example.com', { retries: 1, delayFactor: 0 })).rejects.toBe(error);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should recover from a network error', async () => {
    const spy = mockFetch([new Error('network down'), json({ ok: true })]);
    const response = await fetch('https://example.com', { delayFactor: 0 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('should honour the retry-after header', async () => {
    const spy = mockFetch([
      new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
      json({ ok: true }),
    ]);
    const response = await fetch('https://example.com', { delayFactor: 10_000 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });
});
