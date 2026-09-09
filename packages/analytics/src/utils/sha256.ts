/**
 * SHA-256 hex digest, lowercase, computed in the browser with SubtleCrypto — the format every
 * ad platform expects for a hashed identifier, and the same digest the server-side senders
 * produce with `node:crypto`, so a value hashed on either side matches.
 *
 * Asynchronous because `crypto.subtle.digest` is; it rejects where SubtleCrypto is unavailable
 * (an insecure context), so callers decide what to send without the hash.
 */
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
