import { createMiddleware } from '@tanstack/react-start';
import { resolveClickIdCookies, toSetCookieHeaders } from '../click-id/index';

export interface ClickIdMiddlewareOptions {
  /** `Domain` attribute for the cookies, e.g. `.edensign.io`. Omit for a host-only cookie. */
  domain?: string;
  /** `Secure` attribute, default true. Set false only for local http testing. */
  secure?: boolean;
  /** subdomainIndex for a freshly built `_fbc` (com=0, example.com=1, www.example.com=2). Default 1. */
  subdomainIndex?: number;
  /**
   * Re-issue a still-valid `_fbc` on every request as an ITP self-heal (restores the long-lived
   * HTTP cookie if the Meta Pixel's `document.cookie` write re-capped it to 24h in Safari). On by
   * default. Note it attaches a per-user `Set-Cookie` — and thus `no-store` — to every page
   * response carrying an `_fbc`, defeating CDN caching of those pages; set false to strictly follow
   * Meta's conditional-write rule and keep them cacheable. See {@link resolveClickIdCookies}.
   */
  refresh?: boolean;
  /**
   * Override the `Cache-Control` of a response we attach cookies to (default `private, no-store`).
   * A per-user `Set-Cookie` must never end up on a shared-cache entry, or one visitor's `_fbc` would
   * be served to everyone. Only set this false if you guarantee these responses are never cached.
   */
  cacheControl?: string | false;
  /**
   * Consent gate. Return false to skip setting cookies for this request (e.g. before the visitor has
   * granted consent where required). Runs per request with the incoming `Request`.
   */
  shouldPersist?: (request: Request) => boolean;
}

/**
 * TanStack Start request middleware that persists ad click-id cookies (`_fbc`, `_rdt_cid`) on the
 * document response.
 *
 * Setting `_fbc` here — on the top document via an HTTP `Set-Cookie` header, before any client JS
 * runs — is what Meta officially recommends and the only reliable way to keep the cookie alive for
 * 90 days in Safari: ITP caps JavaScript-set cookies on a fbclid-decorated landing page to 24
 * hours, and a document response is never classified as CNAME/IP cloaking (it is the reference the
 * browser measures cloaking against).
 *
 * Register it as a global request middleware:
 * ```ts
 * // start.ts
 * import { createStart } from '@tanstack/react-start'
 * import { clickIdMiddleware } from '@shware/analytics/tanstack'
 * export const startInstance = createStart(() => ({ requestMiddleware: [clickIdMiddleware] }))
 * ```
 *
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 */
export function createClickIdMiddleware(options: ClickIdMiddlewareOptions = {}) {
  const { cacheControl = 'private, no-store' } = options;

  return createMiddleware({ type: 'request' }).server(async ({ request, next, handlerType }) => {
    const result = await next();

    // Skip serverFn RPC responses. 'router' covers SSR document requests *and* custom server
    // routes (API endpoints) — those also get cookies when the URL carries a click id.
    if (handlerType !== 'router') return result;
    if (options.shouldPersist && !options.shouldPersist(request)) return result;

    const { cookies } = resolveClickIdCookies({
      url: request.url,
      cookieHeader: request.headers.get('cookie'),
      domain: options.domain,
      secure: options.secure,
      subdomainIndex: options.subdomainIndex,
      refresh: options.refresh ?? true,
    });

    if (cookies.length > 0) {
      for (const header of toSetCookieHeaders(cookies)) {
        result.response.headers.append('set-cookie', header);
      }
      if (cacheControl !== false) {
        result.response.headers.set('cache-control', cacheControl);
      }
    }

    return result;
  });
}

/** Ready-to-register middleware with default options. */
export const clickIdMiddleware = createClickIdMiddleware();
