import { describe, expect, test } from 'vitest';
import { JourneyClient, JourneyClientError } from '../src/client';

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchFn };
}

describe('JourneyClient', () => {
  test('identify and track post JSON with the bearer to the Worker', async () => {
    const { calls, fetchFn } = stub(200, { id: 'evt-1', stored: true, woke: 0, started: [] });
    const client = new JourneyClient({ origin: 'https://wf.example/', token: 't', fetch: fetchFn });

    await client.identify('u1', { email: 'a@example.com', plan: null });
    const result = await client.track('u1', 'login', { method: 'email' }, { id: 'evt-1' });

    expect(result).toEqual({ id: 'evt-1', stored: true, woke: 0, started: [] });
    expect(calls.map((c) => c.url)).toEqual([
      'https://wf.example/identify',
      'https://wf.example/events',
    ]);
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer t' });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({
      id: 'evt-1',
      userId: 'u1',
      event: 'login',
      payload: { method: 'email' },
    });
  });

  test('a non-2xx answer becomes an error carrying status and body', async () => {
    const { fetchFn } = stub(401, { error: 'unauthorized' });
    const client = new JourneyClient({ origin: 'https://wf.example', fetch: fetchFn });

    await expect(client.track('u1', 'login')).rejects.toBeInstanceOf(JourneyClientError);
    await expect(client.track('u1', 'login')).rejects.toMatchObject({
      status: 401,
      path: '/events',
    });
  });
});
