/**
 * Who may call the host's protected routes. By default the env's `API_TOKEN` as a bearer; a host
 * replaces it with its own `Authorize` (an HMAC over the body, a JWT, a header its proxy adds).
 * The helpers here are what such an authorizer builds on.
 */

/**
 * The host's authorization: receives a copy of the request (so it may read the body) and the
 * env. True lets the request through, false answers 401, a throw answers 500 and is logged — an
 * authorizer that fails never lets a request in. The tracking routes (`/t/...`) and `/health`
 * are public and never reach it.
 */
export type Authorize<Env> = (request: Request, env: Env) => boolean | Promise<boolean>;

const utf8 = new TextEncoder();

/**
 * Whether two byte strings are equal, in time that depends on their length only — never on
 * where they first differ. A plain `===` returns at the first mismatching character, and that
 * timing is measurable over enough requests. The length is still revealed (a mismatch on it
 * answers at once), which is accepted: it is not the secret.
 *
 * `crypto.subtle.timingSafeEqual` is not available on every runtime the host runs on, hence
 * the XOR loop.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Whether two secrets are equal, in time that does not depend on where they differ: both are
 * hashed first, so the comparison runs over equal-length digests whatever their lengths — for an
 * authorizer comparing a signature or a token of its own.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', utf8.encode(a)),
    crypto.subtle.digest('SHA-256', utf8.encode(b)),
  ]);
  return constantTimeEqual(new Uint8Array(x), new Uint8Array(y));
}

/**
 * Whether the request carries `token` as a bearer credential (`Authorization: Bearer <token>`).
 * The scheme is matched case-insensitively, as RFC 9110 says schemes are; the token is compared
 * in constant time.
 */
export function bearerMatches(request: Request, token: string): boolean {
  const header = request.headers.get('authorization');
  if (header === null) return false;
  const space = header.indexOf(' ');
  if (space === -1) return false;
  if (header.slice(0, space).toLowerCase() !== 'bearer') return false;
  const presented = header.slice(space + 1).trim();
  return constantTimeEqual(utf8.encode(presented), utf8.encode(token));
}

/**
 * Whether the request may use the API: always when no token is configured (an open development
 * instance — production refuses to run that way, see `createJourneyHost`), otherwise only with
 * the matching bearer.
 */
export function authorized(request: Request, env: { API_TOKEN?: string | undefined }): boolean {
  return env.API_TOKEN === undefined || bearerMatches(request, env.API_TOKEN);
}
