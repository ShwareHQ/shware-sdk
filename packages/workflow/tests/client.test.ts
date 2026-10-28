import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { JourneyClient, JourneyClientError, JourneyValidationError } from '../src/client';
import { defineContract } from '../src/contract';

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

  test('registerDevice posts the token, the platform and, when given, the registration time', async () => {
    const { calls, fetchFn } = stub(200, { ok: true, woke: 0 });
    const client = new JourneyClient({ origin: 'https://wf.example', fetch: fetchFn });

    await client.registerDevice('u1', { token: 'tok', platform: 'ios' });
    await client.registerDevice('u1', { token: 'tok', platform: 'ios', ts: 1_700_000_000_000 });

    expect(calls.map((c) => c.url)).toEqual([
      'https://wf.example/devices',
      'https://wf.example/devices',
    ]);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      userId: 'u1',
      token: 'tok',
      platform: 'ios',
    });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({
      userId: 'u1',
      token: 'tok',
      platform: 'ios',
      ts: 1_700_000_000_000,
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

describe('JourneyClient subscriptions', () => {
  test('getSubscriptions is a bare GET; setSubscriptions a PUT of the patch, both on the encoded user id', async () => {
    const state = {
      email: { all: true, topics: { promotions: false, newsletter: true } },
    };
    const { calls, fetchFn } = stub(200, state);
    const client = new JourneyClient({ origin: 'https://wf.example', token: 't', fetch: fetchFn });

    expect(await client.getSubscriptions('a/b')).toEqual(state);
    expect(
      await client.setSubscriptions('a/b', { email: { topics: { promotions: false } } })
    ).toEqual(state);

    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ['https://wf.example/subscriptions/a%2Fb', 'GET'],
      ['https://wf.example/subscriptions/a%2Fb', 'PUT'],
    ]);
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toEqual({ authorization: 'Bearer t' });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({
      email: { topics: { promotions: false } },
    });
    expect(calls[1]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  test('with a contract, a topic it does not declare is refused before any request', async () => {
    const contract = defineContract({
      events: {},
      profile: z.strictObject({}),
      subscriptions: { email: ['promotions', 'newsletter'] },
    });
    const { calls, fetchFn } = stub(200, {});
    const client = new JourneyClient({ origin: 'https://wf.example', contract, fetch: fetchFn });
    const error = await client
      .setSubscriptions('u1', { email: { topics: { digest: false } as never } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JourneyValidationError);
    expect((error as JourneyValidationError).issues).toEqual([
      { path: 'email.topics.digest', message: 'not a declared topic' },
    ]);
    expect(calls).toEqual([]);
    await client.setSubscriptions('u1', { email: { all: false, topics: { newsletter: false } } });
    expect(calls).toHaveLength(1);
  });
});
