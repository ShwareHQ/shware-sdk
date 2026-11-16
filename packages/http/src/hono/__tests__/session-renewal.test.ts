import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { describe, expect, it, vi } from 'vitest';
import { type SessionRenewalConfig, sessionRenewal } from '../session-renewal';

describe('sessionRenewal', () => {
  it('hands the request and the final response to auth.renew', async () => {
    const auth: SessionRenewalConfig['auth'] = {
      renew: vi.fn<(request: Request, response: Response) => Response>((_request, response) => {
        response.headers.append('Set-Cookie', 'SESSION=abc; Max-Age=60');
        return response;
      }),
    };
    const app = new Hono();
    app.use(sessionRenewal({ auth }));
    app.get('/me', (c) => {
      setCookie(c, 'other', '1');
      return c.json({ ok: true });
    });

    const res = await app.request('/me');
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual(['other=1; Path=/', 'SESSION=abc; Max-Age=60']);
    expect(auth.renew).toHaveBeenCalledTimes(1);
  });

  it('keeps the cookie on a copy auth.renew returns', async () => {
    const auth: SessionRenewalConfig['auth'] = {
      renew: (_request, response) => {
        const copy = new Response(response.body, response);
        copy.headers.append('Set-Cookie', 'SESSION=abc; Max-Age=60');
        return copy;
      },
    };
    const app = new Hono();
    app.use(sessionRenewal({ auth }));
    app.get('/next', (c) => {
      setCookie(c, 'other', '1');
      return c.redirect('https://example.com/next', 302);
    });

    const res = await app.request('/next');
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie()).toEqual(['other=1; Path=/', 'SESSION=abc; Max-Age=60']);
  });

  it('leaves the response alone when auth.renew does', async () => {
    const app = new Hono();
    app.use(sessionRenewal({ auth: { renew: (_request, response) => response } }));
    app.get('/me', (c) => c.text('OK'));

    const res = await app.request('/me');
    expect(await res.text()).toBe('OK');
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
