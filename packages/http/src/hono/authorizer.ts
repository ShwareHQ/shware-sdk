import type { MiddlewareHandler } from 'hono';
import { METHOD_NAME_ALL } from 'hono/router';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { SmartRouter } from 'hono/router/smart-router';
import { TrieRouter } from 'hono/router/trie-router';
import { Status } from '../error/status';

type Methods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type Auth = { isAuthenticated: (request: Request) => Promise<boolean> };

export type AuthRule = string | { path: string; methods?: [Methods, ...Methods[]] };

export interface AuthorizerConfig {
  auth: Auth;
  errorMessage?: string;
  rules?: AuthRule[];
}

export function authorizer({
  auth,
  errorMessage = 'Unauthorized, please login to continue.',
  rules = [],
}: AuthorizerConfig): MiddlewareHandler {
  const router = new SmartRouter<null>({ routers: [new RegExpRouter(), new TrieRouter()] });

  for (const rule of rules) {
    if (typeof rule === 'string') {
      router.add(METHOD_NAME_ALL, rule, null);
    } else if (rule.methods && rule.methods.length > 0) {
      for (const method of rule.methods) {
        router.add(method, rule.path, null);
      }
    } else {
      router.add(METHOD_NAME_ALL, rule.path, null);
    }
  }

  return async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    const [matched] = router.match(c.req.method, c.req.path);
    if (matched.length === 0) {
      await next();
      return;
    }

    const authenticated = await auth.isAuthenticated(c.req.raw);
    if (!authenticated) throw Status.unauthorized(errorMessage).error();
    await next();
  };
}
