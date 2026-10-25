/**
 * Query parameter names that carry a one-time credential or a secret: OAuth's `code`/`state` and
 * tokens, a Stripe Checkout `session_id`, API keys, one-time passwords. Compared lower-cased.
 */
export const REDACTED_URL_PARAMS: readonly string[] = [
  'code',
  'state',
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'session_id',
  'api_key',
  'apikey',
  'secret',
  'password',
  'otp',
];

const redacted = new Set(REDACTED_URL_PARAMS);

/** `part` from its `sep` on is a query string: drop the redacted names, keep the rest. */
function redactAfter(part: string, sep: string): string {
  const at = part.indexOf(sep);
  if (at === -1 || !part.includes('=')) return part;
  const params = new URLSearchParams(part.slice(at + 1));
  // A copy of the keys: deleting while iterating the live iterator would skip entries.
  for (const key of Array.from(params.keys())) {
    if (redacted.has(key.toLowerCase())) params.delete(key);
  }
  const rest = params.toString();
  return rest ? `${part.slice(0, at + 1)}${rest}` : part.slice(0, at);
}

/**
 * The URL without the credential-bearing query parameters in `REDACTED_URL_PARAMS`, from its query
 * and from a hash shaped like one (an implicit flow's `#access_token=…`, a hash router's
 * `#/callback?code=…`), so an OAuth or payment redirect's one-time values never reach the
 * analytics tables as `page_location` or `page_referrer`. Kept parameters come back in
 * `URLSearchParams` form (`a b` as `a+b`); a string with no query and no hash is returned as is.
 */
export function redactUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const head = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  return redactAfter(head, '?') + redactAfter(hash, hash.includes('?') ? '?' : '#');
}
