/**
 * The smallest SQL client this store needs: parameterized queries (`$1`, `$2`,
 * …) and a transaction scope. It is deliberately not postgres.js, pg or
 * drizzle — the app wraps whichever it already uses in a few lines:
 *
 *   const client: SqlClientLike = {
 *     query: (text, params) => sql.unsafe(text, params),          // postgres.js
 *     transaction: (fn) => sql.begin((tx) => fn(wrap(tx))),
 *   };
 *
 * jsonb columns may come back parsed (postgres.js, pg) or as strings (some
 * drivers); both are accepted.
 */
export interface SqlClientLike {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlClientLike) => Promise<T>): Promise<T>;
}

/**
 * UUID v7 (time-ordered) for event rows, generated here so the store has no
 * dependency: 48-bit ms timestamp, version 7, RFC 4122 variant, 74 random bits.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
