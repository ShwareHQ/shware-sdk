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

function paramName(pair: string): string {
  const raw = pair.split('=', 1)[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** `a=1&code=2&b=3` → `a=1&b=3`; `null` when nothing was removed. */
function redactParams(params: string): string | null {
  const pairs = params.split('&');
  const kept = pairs.filter((pair) => !redacted.has(paramName(pair)));
  return kept.length === pairs.length ? null : kept.join('&');
}

function redactHash(hash: string): string {
  // A hash router's own query (`#/callback?code=…`), or an implicit flow's `#access_token=…`.
  const at = hash.indexOf('?');
  if (at !== -1) {
    const rest = redactParams(hash.slice(at + 1));
    if (rest === null) return hash;
    return rest ? `${hash.slice(0, at)}?${rest}` : hash.slice(0, at);
  }
  if (!hash.includes('=')) return hash;
  return redactParams(hash) ?? hash;
}

/**
 * The URL without the credential-bearing query parameters in `REDACTED_URL_PARAMS`, from its query
 * and from a hash shaped like one, so an OAuth or payment redirect's one-time values never reach
 * the analytics tables as `page_location` or `page_referrer`. Every other parameter is kept as
 * written and in order.
 *
 * Plain string work rather than `new URL`, which would re-encode what it keeps and is incomplete
 * in React Native; a string with no query and no hash comes back unchanged.
 */
export function redactUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? undefined : url.slice(hashAt + 1);

  const queryAt = beforeHash.indexOf('?');
  let base = beforeHash;
  if (queryAt !== -1) {
    const rest = redactParams(beforeHash.slice(queryAt + 1));
    if (rest !== null)
      base = rest ? `${beforeHash.slice(0, queryAt)}?${rest}` : beforeHash.slice(0, queryAt);
  }

  if (hash === undefined) return base;
  const nextHash = redactHash(hash);
  // Drop the `#` only when the redaction emptied the hash, not for a URL that ends in one.
  return nextHash || nextHash === hash ? `${base}#${nextHash}` : base;
}
