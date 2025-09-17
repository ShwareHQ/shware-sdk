import { timingSafeEqual } from 'crypto';
import { getCookie } from 'hono/cookie';
import { METHOD_NAME_ALL } from 'hono/router';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { SmartRouter } from 'hono/router/smart-router';
import { TrieRouter } from 'hono/router/trie-router';
import { Status } from '../error/status';
import type { MiddlewareHandler } from 'hono';

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type CSRFIgnoreRule = string | { path: string; methods?: [HTTPMethod, ...HTTPMethod[]] };

export interface CSRFConfig {
  /**
   * Cookie name for CSRF token
   * @default 'XSRF-TOKEN'
   */
  cookieName?: string;

  /**
   * Header name for CSRF token
   * @default 'X-XSRF-TOKEN'
   */
  headerName?: string;

  /**
   * Ignore rules for specific paths and methods
   * @example
   * [
   *   { path: '/api/webhook/*', methods: ['POST'] },
   *   { path: '/auth/apple/callback' }, // ignores all methods
   * ]
   */
  ignores?: CSRFIgnoreRule[];

  /**
   * Skip CSRF check for these methods
   * @default ['GET', 'HEAD', 'OPTIONS']
   */
  safeMethods?: HTTPMethod[];

  /**
   * Origin allowed to bypass CSRF check
   * @default undefined
   */
  origin?: string[];

  /**
   * Sec-Fetch-Site allowed to bypass CSRF check
   * @default undefined
   */
  secFetchSite?: Array<'same-origin' | 'same-site' | 'none' | 'cross-origin'>;

  /**
   * Custom error message
   * @default 'CSRF token validation failed'
   */
  errorMessage?: string;
}

/** use timing safe compare to prevent timing attack */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;

  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Create CSRF protection middleware
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { csrf } from '@shware/http/hono';
 *
 * const app = new Hono();
 *
 * // basic usage
 * app.use(csrf());
 *
 * // with configuration
 * app.use(csrf({
 *   cookieName: 'csrf-token',
 *   headerName: 'X-CSRF-Token',
 *   ignores: [
 *     { path: '/api/webhook/*', methods: ['POST'] },
 *     { path: '/auth/apple/callback' },
 *   ]
 * }));
 * ```
 */
export function csrf(config: CSRFConfig = {}): MiddlewareHandler {
  const cookieName = config.cookieName ?? 'XSRF-TOKEN';
  const headerName = config.headerName ?? 'X-XSRF-TOKEN';
  const safeMethods = new Set(config.safeMethods ?? ['GET', 'HEAD', 'OPTIONS']);
  const errorMessage = config.errorMessage ?? 'CSRF token validation failed';

  // initialize router for matching ignore rules
  const router = new SmartRouter<boolean>({
    routers: [new RegExpRouter(), new TrieRouter()],
  });

  // register ignore rules
  if (config.ignores) {
    for (const rule of config.ignores) {
      if (typeof rule === 'string') {
        router.add(METHOD_NAME_ALL, rule, true);
      } else if (rule.methods && rule.methods.length > 0) {
        for (const method of rule.methods) {
          router.add(method, rule.path, true);
        }
      } else {
        // if no methods are specified, ignore all methods
        router.add(METHOD_NAME_ALL, rule.path, true);
      }
    }
  }

  // return middleware
  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;

    // check if the request should be ignored
    // 1. ignore safe methods
    if (safeMethods.has(method)) {
      await next();
      return;
    }

    // 2. ignore configured origin
    if (config.origin && config.origin.includes(c.req.header('origin') ?? '')) {
      await next();
      return;
    }

    // 3. ignore configured secFetchSite
    if (
      config.secFetchSite &&
      config.secFetchSite.includes((c.req.header('sec-fetch-site') ?? '') as never)
    ) {
      await next();
      return;
    }

    // 4. ignore configured ignore rules
    const [matched] = router.match(method, path);
    if (matched.length > 0) {
      await next();
      return;
    }

    const cookieToken = getCookie(c, cookieName);
    const headerToken = c.req.header(headerName);

    if (!cookieToken || !headerToken) {
      throw Status.permissionDenied(errorMessage).error();
    }

    if (!safeCompare(cookieToken, headerToken)) {
      throw Status.permissionDenied(errorMessage).error();
    }

    await next();
  };
}
