import type { MiddlewareHandler } from 'hono';

type Auth = { renew: (request: Request, response: Response) => Response };

export interface SessionRenewalConfig {
  auth: Auth;
}

/**
 * Hands every response to `auth.renew` (`@shware/security`'s `Auth`), so the session cookie's
 * expiry slides with the session's on the requests that authenticated and renewed it.
 */
export function sessionRenewal({ auth }: SessionRenewalConfig): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const response = auth.renew(c.req.raw, c.res);
    if (response === c.res) return;
    // Clear first: assigning over a response copies its headers, Set-Cookie included, onto the new one.
    c.res = undefined;
    c.res = response;
  };
}
