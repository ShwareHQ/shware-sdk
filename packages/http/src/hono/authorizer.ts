import { METHOD_NAME_ALL } from 'hono/router';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { SmartRouter } from 'hono/router/smart-router';
import { TrieRouter } from 'hono/router/trie-router';
import { Status } from '../error/status';
import type { MiddlewareHandler } from 'hono';

type Methods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type Auth = { isAuthenticated: (request: Request) => Promise<boolean> };

export class Authorizer {
  private readonly router = new SmartRouter<null>({
    routers: [new RegExpRouter(), new TrieRouter()],
  });

  private readonly auth: Auth;

  private constructor(auth: Auth) {
    this.auth = auth;
  }

  static create = (auth: Auth) => new Authorizer(auth);

  match(path: string, methods?: [Methods, ...Methods[]]) {
    if (methods) {
      for (const method of methods) {
        this.router.add(method, path, null);
      }
    } else {
      this.router.add(METHOD_NAME_ALL, path, null);
    }
    return this;
  }

  build = (): MiddlewareHandler => {
    return async (c, next) => {
      if (c.req.method === 'OPTIONS') {
        await next();
        return;
      }

      const [matched] = this.router.match(c.req.method, c.req.path);
      if (matched.length === 0) {
        await next();
        return;
      }

      const authenticated = await this.auth.isAuthenticated(c.req.raw);
      if (!authenticated) throw Status.unauthorized().error();
      await next();
    };
  };
}

export interface AuthorizerConfig {
  auth: Auth;
  errorMessage?: string;
  rules?: { path: string; methods?: [Methods, ...Methods[]] }[];
}

export function authorizer({
  auth,
  errorMessage = 'Unauthorized, please login to continue.',
  rules = [],
}: AuthorizerConfig): MiddlewareHandler {
  const router = new SmartRouter<null>({ routers: [new RegExpRouter(), new TrieRouter()] });

  for (const { path, methods = [METHOD_NAME_ALL] } of rules) {
    for (const method of methods) {
      router.add(method, path, null);
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
