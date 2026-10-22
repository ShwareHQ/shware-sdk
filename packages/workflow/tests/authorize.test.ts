import { describe, expect, test } from 'vitest';
import { bearerMatches, timingSafeEqual } from '../src/cloudflare';
import { journeyWorker } from '../src/cloudflare/worker';
import type { Authorize } from '../src/host/auth';
import type { JourneyEnv } from '../src/host/platform';
import { defineConfig, event, trigger, workflow } from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
import { makeEnv } from './fake-cloudflare';
import { plainEmail } from './fixtures';

/**
 * The host's `authorize` option: the caller decides what a valid request looks like (here an
 * HMAC over the body), every API route asks it, and the public routes never do.
 */

const e = event<{ login: Record<string, never> }>();
const hi = plainEmail('hi');
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

function setup(authorize: Authorize<JourneyEnv> | undefined, overrides: Partial<JourneyEnv> = {}) {
  const { env, db } = makeEnv({ ENVIRONMENT: 'development', ...overrides });
  const asked: string[] = [];
  const worker = journeyWorker<JourneyEnv>({
    config,
    // A store that keeps reporting serves the tracking routes; a pixel for an unknown copy is
    // all they need here
    store: () => {
      const store = new D1JourneyStore(db);
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
          authorize: async (request: Request, hostEnv: JourneyEnv) => {
            asked.push(new URL(request.url).pathname);
            return authorize(request, hostEnv);
          },
        }),
  });
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://w.test${path}`, init), env);
  return { call, asked };
}

describe('authorize', () => {
  const hmac: Authorize<JourneyEnv> = async (request) => {
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

  test('every API route asks it; /health and the tracking routes never do', async () => {
    const { call, asked } = setup(async () => false);
    for (const [path, method] of [
      ['/bundle', 'GET'],
      ['/bundle/deploy', 'POST'],
      ['/preview/hi', 'GET'],
      ['/segments/sweep', 'POST'],
      ['/identify', 'POST'],
      ['/users/forget', 'POST'],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401);
    }
    expect(asked).toEqual([
      '/bundle',
      '/bundle/deploy',
      '/preview/hi',
      '/segments/sweep',
      '/identify',
      '/users/forget',
    ]);
    asked.length = 0;
    expect((await call('/health')).status).toBe(200);
    const pixel = await call('/t/o/0190f000-0000-7000-8000-000000000000');
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    expect(asked).toEqual([]);
  });

  test('it receives the env the host validated', async () => {
    const seen: string[] = [];
    const { call } = setup(async (_request, hostEnv) => {
      seen.push(hostEnv.ENVIRONMENT ?? '');
      return true;
    });
    expect((await call('/bundle')).status).toBe(200);
    expect(seen).toEqual(['development']);
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
    expect(await response.json()).toEqual({ error: 'internal error' });
  });

  test('production needs no API_TOKEN when the host authorizes callers itself', async () => {
    const { call } = setup(async () => true, { ENVIRONMENT: 'production' });
    expect((await call('/bundle')).status).toBe(200);
    // Without an authorizer the same host refuses to serve open
    const open = setup(undefined, { ENVIRONMENT: 'production' });
    expect((await open.call('/bundle')).status).toBe(503);
  });

  test("without one, the env's API_TOKEN bearer applies", async () => {
    const { call } = setup(undefined, { API_TOKEN: 'secret' });
    const withAuth = (authorization?: string) =>
      call('/bundle', { headers: authorization === undefined ? {} : { authorization } });
    expect((await withAuth()).status).toBe(401);
    expect((await withAuth('Bearer nope')).status).toBe(401);
    expect((await withAuth('Bearer secret')).status).toBe(200);
  });
});

describe('bearerMatches and timingSafeEqual', () => {
  test('compare whole secrets, whatever their lengths', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true);
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(await timingSafeEqual('', 'x')).toBe(false);
    const request = (value?: string) =>
      new Request('https://w.test/', {
        headers: value === undefined ? {} : { authorization: value },
      });
    expect(bearerMatches(request('Bearer t0k'), 't0k')).toBe(true);
    expect(bearerMatches(request('bearer t0k'), 't0k')).toBe(true);
    expect(bearerMatches(request('Bearer t0'), 't0k')).toBe(false);
    expect(bearerMatches(request(), 't0k')).toBe(false);
  });
});
