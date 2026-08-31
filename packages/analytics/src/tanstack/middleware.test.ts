import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The TanStack wrapper is mocked away so the server handler runs bare: what these tests pin down
 * is the middleware's own behavior — which responses get cookies, the consent gate, and the
 * cache-control guard that keeps a per-user Set-Cookie off shared caches.
 */
type ServerContext = {
  request: Request;
  next: () => Promise<{ response: Response }>;
  handlerType: 'router' | 'server-fn';
};
type ServerFn = (ctx: ServerContext) => Promise<{ response: Response }>;

const { captured } = vi.hoisted(() => ({ captured: { server: null as ServerFn | null } }));

vi.mock('@tanstack/react-start', () => ({
  createMiddleware: () => ({
    server: (fn: ServerFn) => {
      captured.server = fn;
      return { __middleware: true };
    },
  }),
}));

import { createClickIdMiddleware } from './middleware';

const NOW = Date.parse('2026-01-01T00:00:00Z');

type RunInput = {
  url?: string;
  cookieHeader?: string;
  handlerType?: 'router' | 'server-fn';
  response?: Response;
};

async function run(
  options: Parameters<typeof createClickIdMiddleware>[0],
  {
    url = 'https://shware.io/?fbclid=CLK1',
    cookieHeader,
    handlerType = 'router',
    response = new Response('<html></html>', { status: 200 }),
  }: RunInput = {}
) {
  createClickIdMiddleware(options);
  const server = captured.server;
  if (!server) throw new Error('middleware never registered its server fn');

  const headers: Record<string, string> = cookieHeader ? { cookie: cookieHeader } : {};
  const result = await server({
    request: new Request(url, { headers }),
    next: async () => ({ response }),
    handlerType,
  });
  return result.response;
}

beforeEach(() => {
  captured.server = null;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  return () => vi.useRealTimers();
});

describe('clickIdMiddleware', () => {
  it('sets the click-id cookies on a document response and forces no-store', async () => {
    const response = await run({});

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain(`_fbc=fb.1.${NOW}.CLK1`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('appends one Set-Cookie per resolved cookie', async () => {
    const response = await run({}, { url: 'https://shware.io/?fbclid=CLK1&rdt_cid=RDT1' });

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('_fbc=');
    expect(setCookie).toContain('_rdt_cid=RDT1');
  });

  it('leaves serverFn RPC responses alone', async () => {
    const response = await run({}, { handlerType: 'server-fn' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('touches neither cookies nor cache-control when there is nothing to set', async () => {
    const response = await run({}, { url: 'https://shware.io/pricing' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('honors the consent gate', async () => {
    const shouldPersist = vi.fn(() => false);
    const response = await run({ shouldPersist });

    expect(shouldPersist).toHaveBeenCalledWith(expect.any(Request));
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('forwards domain/secure/refresh options into cookie resolution', async () => {
    const stillValid = `fb.1.${NOW - 1000}.CLK1`;
    const response = await run(
      { domain: '.shware.io', refresh: false },
      { url: 'https://shware.io/', cookieHeader: `_fbc=${stillValid}` }
    );

    // refresh: false leaves a valid cookie alone — nothing on the wire, page stays cacheable.
    expect(response.headers.get('set-cookie')).toBeNull();

    const fresh = await run({ domain: '.shware.io' });
    expect(fresh.headers.get('set-cookie')).toContain('Domain=.shware.io');
  });

  it('cacheControl: false skips the cache-control override', async () => {
    const response = await run({ cacheControl: false });
    expect(response.headers.get('set-cookie')).toContain('_fbc=');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('does not overwrite an expired-cookie deletion with a stale value', async () => {
    const expired = `fb.1.${NOW - 91 * 24 * 60 * 60 * 1000}.OLD`;
    const response = await run({}, { url: 'https://shware.io/', cookieHeader: `_fbc=${expired}` });

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('_fbc=;'); // cleared
    expect(setCookie).toContain('Max-Age=0');
  });
});
