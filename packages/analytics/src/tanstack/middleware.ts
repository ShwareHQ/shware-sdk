import { createMiddleware } from '@tanstack/react-start';
import { resolveClickIdCookies, toSetCookieHeaders } from '../click-id/index';

export interface ClickIdMiddlewareOptions {
  /**
   * `Domain` attribute for the cookies: the site's registrable domain, e.g. `.shware.io`, where the
   * pixels write theirs. Required — set it in production; `null` (host-only) is for `localhost`.
   * See `ResolveClickIdCookiesInput.domain`.
   */
  domain: string | null;
  /** `Secure` attribute, default true. Set false only for local http testing. */
  secure?: boolean;
  /** subdomainIndex for a freshly built `_fbc` (com=0, example.com=1, www.example.com=2). Default 1. */
  subdomainIndex?: number;
  /**
   * Re-issue the stored click and browser ids on every request as an ITP self-heal: the pixels
   * rewrite them through `document.cookie`, which Safari caps at 7 days (24 hours on an
   * ad-decorated landing), and the re-issue restores the long-lived HTTP cookie. On by default.
   * Note it attaches a per-user `Set-Cookie` — and thus `no-store` — to every page response of a
   * visitor carrying one; set false to keep those pages CDN-cacheable. See
   * {@link resolveClickIdCookies}.
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
 * TanStack Start request middleware that persists the ad platforms' first-party cookies on the
 * document response: `_fbc`, `_fbp`, `_gcl_aw` / `_gcl_gb`, `_rdt_cid`, `_rdt_uuid`,
 * `_uetmsclkid`, `__oppref` and `__obref`.
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
 * import { createClickIdMiddleware } from '@shware/analytics/tanstack'
 * const clickIdMiddleware = createClickIdMiddleware({
 *   domain: import.meta.env.DEV ? null : '.example.com',
 *   secure: !import.meta.env.DEV,
 * })
 * export const startInstance = createStart(() => ({ requestMiddleware: [clickIdMiddleware] }))
 * ```
 *
 * reference: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 */
export function createClickIdMiddleware(options: ClickIdMiddlewareOptions) {
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
