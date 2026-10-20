import type { JourneyEnv } from '../cloudflare/bindings';

/**
 * Who may call the host's protected routes: the ingest API (`/events`, `/identify`, `/devices`,
 * `/users/forget`, `/deploy`, ...), `/bundle`, `/bundle/deploy`, `/preview/*` and
 * `/segments/sweep`. The tracking routes (`/t/...`) and `/health` are public by design — mail
 * clients, mailbox providers' one-click unsubscribe and push beacons cannot authenticate — and
 * never reach it.
 *
 * It receives a copy of the request, so it may read the body (an HMAC over it, say) without
 * consuming the one the route reads. Resolve true to let the request through; false answers 401.
 * A throw answers 500 and is logged: an authorizer that fails never lets a request in.
 */
export type Authorize<Env> = (request: Request, env: Env) => boolean | Promise<boolean>;

const utf8 = new TextEncoder();

/**
 * Compare two secrets in time that does not depend on where they differ: both are hashed first,
 * so the comparison runs over equal-length digests whatever their lengths.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', utf8.encode(a)),
    crypto.subtle.digest('SHA-256', utf8.encode(b)),
  ]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/**
 * `Authorization: Bearer <token>`, compared in constant time. An unset token lets every request
 * through: an open instance, for local development only.
 */
export function bearerToken(token: string | undefined): (request: Request) => Promise<boolean> {
  return async (request) => {
    if (token === undefined) return true;
    const header = request.headers.get('authorization') ?? '';
    return timingSafeEqual(header, `Bearer ${token}`);
  };
}

/** The default: the env's `API_TOKEN` as a bearer. */
export const apiTokenBearer: Authorize<JourneyEnv> = (request, env) =>
  bearerToken(env.API_TOKEN)(request);
