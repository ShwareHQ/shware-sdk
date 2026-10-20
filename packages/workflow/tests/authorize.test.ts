import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { bearerToken, timingSafeEqual } from '../src/cloudflare';
import { journeyWorker } from '../src/cloudflare/worker';
import { defineConfig, emailTemplate, event, trigger, workflow } from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
import { FakeD1, FakeJourney, FakeKV } from './fake-cloudflare';

/**
 * The host's `authorize` option: the caller decides what a valid request looks like (here an
 * HMAC over the body), every protected route asks it, and the public routes never do.
 */

const e = event<{ login: Record<string, never> }>();
const hi = emailTemplate({
  id: 'hi',
  from: 'hi@acme.test',
  title: 'Hi',
  props: z.strictObject({}),
  subject: 'Hi',
  preview: {},
  component: () => createElement('p', null, 'hi'),
});
const config = defineConfig({
  workflows: [workflow({ id: 'w', trigger: trigger.event(e.login) }).email(hi, {})],
  templates: { email: { hi } },
});

const SECRET = 'webhook-secret';

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setup(authorize: Parameters<typeof journeyWorker>[0]['authorize']) {
  const env = { JOURNEY: new FakeJourney() };
  const asked: string[] = [];
  const worker = journeyWorker<typeof env>({
    config,
    // A store that keeps reporting serves the tracking routes; a pixel for an unknown copy is
    // all they need here
    store: () => {
      const store = new D1JourneyStore(new FakeD1(), new FakeKV());
      const reporting = { recordOpen: async () => false };
      return new Proxy(store, {
        get: (target, property) =>
          property === 'reporting' ? reporting : Reflect.get(target, property, target),
      });
    },
    email: () => ({ send: async () => ({}) }),
    ...(authorize === undefined
      ? {}
      : {
          authorize: async (request, env) => {
            asked.push(new URL(request.url).pathname);
            return authorize(request, env);
          },
        }),
  });
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://w.test${path}`, init), env);
  return { call, asked };
}

describe('authorize', () => {
  const hmac = async (request: Request) => {
    const signature = request.headers.get('x-signature') ?? '';
    return timingSafeEqual(signature, await hmacHex(SECRET, await request.text()));
  };

  test('the host decides the format: an HMAC over the body, and the route still reads it', async () => {
    const { call } = setup(hmac);
    const body = JSON.stringify({ userId: 'u1', event: 'login' });
    const signed = await call('/events', {
      method: 'POST',
      headers: { 'x-signature': await hmacHex(SECRET, body) },
      body,
    });
    expect(signed.status).toBe(200);
    expect(await signed.json()).toMatchObject({ stored: true });

    const forged = await call('/events', {
      method: 'POST',
      headers: { 'x-signature': await hmacHex('wrong', body) },
      body,
    });
    expect(forged.status).toBe(401);
  });

  test('every protected route asks it; /health and the tracking routes never do', async () => {
    const { call, asked } = setup(async () => false);
    for (const [path, method] of [
      ['/bundle', 'GET'],
      ['/bundle/deploy', 'POST'],
      ['/preview/hi', 'GET'],
      ['/segments/sweep', 'POST'],
      ['/identify', 'POST'],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401);
    }
    expect(asked).toEqual([
      '/bundle',
      '/bundle/deploy',
      '/preview/hi',
      '/segments/sweep',
      '/identify',
    ]);
    asked.length = 0;
    expect((await call('/health')).status).toBe(200);
    const pixel = await call('/t/o/0190f000-0000-7000-8000-000000000000');
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    expect(asked.filter((path) => path.startsWith('/t/') || path === '/health')).toEqual([]);
  });

  test('an authorizer that throws never lets the request in', async () => {
    const { call } = setup(async () => {
      throw new Error('key service down');
    });
    const response = await call('/events', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', event: 'login' }),
    });
    expect(response.status).toBe(500);
  });

  test("without one, the env's API_TOKEN bearer applies, as before", async () => {
    const env = { JOURNEY: new FakeJourney(), API_TOKEN: 'secret' };
    const worker = journeyWorker<typeof env>({
      config,
      store: () => new D1JourneyStore(new FakeD1(), new FakeKV()),
      email: () => ({ send: async () => ({}) }),
    });
    const call = (authorization?: string) =>
      worker.fetch(
        new Request('https://w.test/bundle', {
          headers: authorization === undefined ? {} : { authorization },
        }),
        env
      );
    expect((await call()).status).toBe(401);
    expect((await call('Bearer nope')).status).toBe(401);
    expect((await call('Bearer secret')).status).toBe(200);
  });
});

describe('bearerToken and timingSafeEqual', () => {
  test('compare whole secrets, whatever their lengths', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true);
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(await timingSafeEqual('', 'x')).toBe(false);
    const check = bearerToken('t0k');
    const with_ = (value?: string) =>
      new Request('https://w.test/', {
        headers: value === undefined ? {} : { authorization: value },
      });
    expect(await check(with_('Bearer t0k'))).toBe(true);
    expect(await check(with_('Bearer t0'))).toBe(false);
    expect(await check(with_())).toBe(false);
    // Unset: an open development instance
    expect(await bearerToken(undefined)(with_())).toBe(true);
  });
});
