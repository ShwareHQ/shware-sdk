import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClickIdMiddlewareOptions, createClickIdMiddleware } from './middleware';
type ServerFn = NonNullable<ReturnType<typeof createClickIdMiddleware>['options']['server']>;

const NOW = Date.parse('2026-01-01T00:00:00Z');

type RunInput = {
  url?: string;
  cookieHeader?: string;
  handlerType?: Parameters<ServerFn>[0]['handlerType'];
  response?: Response;
};

async function run(
  options: Partial<Parameters<typeof createClickIdMiddleware>[0]>,
  {
    url = 'https://shware.io/?fbclid=CLK1',
    cookieHeader,
    handlerType = 'router',
    response = new Response('<html></html>', { status: 200 }),
  }: RunInput = {}
) {
  const server = createClickIdMiddleware({ domain: null, ...options }).options.server;
  if (!server) throw new Error('middleware never registered its server fn');

  const headers: Record<string, string> = cookieHeader ? { cookie: cookieHeader } : {};
  const request = new Request(url, { headers });
  const pathname = new URL(request.url).pathname;
  const { next } = vi.mockObject<{ next: Parameters<typeof server>[0]['next'] }>({
    next() {
      throw new Error('The terminal response must be configured');
    },
  });
  next.mockReturnValue({ request, pathname, context: undefined, response });
  const result = await server({ request, pathname, context: undefined, next, handlerType });
  return result instanceof Response ? result : result.response;
}

beforeEach(() => {
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
    const response = await run({}, { handlerType: 'serverFn' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('touches neither cookies nor cache-control when there is nothing to set', async () => {
    const response = await run({}, { url: 'https://shware.io/pricing' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('honors the consent gate', async () => {
    const shouldPersist = vi.fn<NonNullable<ClickIdMiddlewareOptions['shouldPersist']>>(
      () => false
    );
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

  it('keeps a private response cacheable as it was: no shared cache can store it anyway', async () => {
    const response = await run(
      {},
      {
        response: new Response('/* gtag */', {
          headers: { 'cache-control': 'private, max-age=900' },
        }),
      }
    );
    expect(response.headers.get('set-cookie')).toContain('_fbc=');
    expect(response.headers.get('cache-control')).toBe('private, max-age=900');
  });

  it('still makes a shared-cacheable response uncacheable', async () => {
    for (const value of ['public, max-age=60', 'max-age=60, s-maxage=600']) {
      const response = await run(
        {},
        { response: new Response('x', { headers: { 'cache-control': value } }) }
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
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
