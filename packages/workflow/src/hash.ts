/**
 * Content hashing — contentHash covers execution semantics only.
 *
 * Human-facing metadata (description / tags / owner, node labels) is excluded,
 * because it cannot change which path a user takes:
 * - rewording a description must not invalidate the version an in-flight
 *   journey is pinned to;
 * - nor should it surface as a change in `plan`.
 *
 * Storage, by contrast, always keeps the full IR (including the latest
 * description). contentHash carries exactly two responsibilities: deciding
 * whether semantics moved (plan / migration), and pinning a version for
 * in-flight instances. So after a description edit: the UI shows the new text,
 * plan reports no change, and in-flight users are untouched.
 */

/**
 * Keys excluded from hashing.
 * - meta: metadata at any level — workflow (description / tags / owner) and
 *   node/segment provenance (`loc`, the callsite source map)
 * - label: node and branch-arm names (UI titles / observability, never routing)
 * - contentHash: the hash itself
 *
 * Note that a cohort arm's `name` IS hashed: it becomes part of the node id
 * (`{id}.{armName}.{j}`), and node ids are durable step names — renaming an arm
 * changes execution identity.
 */
const UNHASHED_KEYS = new Set(['meta', 'label', 'contentHash']);

/** Recursively drop metadata fields, leaving pure execution semantics. */
export function stripMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (UNHASHED_KEYS.has(key)) continue;
      out[key] = stripMeta(item);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: sorted keys, no whitespace — a stable hash input. */
export function canonicalJSON(value: unknown): string {
  // JSON.stringify(undefined) returns undefined, not a string; absent fields become null
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJSON((value as Record<string, unknown>)[key])}`
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/*
 * SHA-256, hand-written and synchronous: crypto.subtle is async (and absent in
 * some embedders), node:crypto is Node-only — the compiler must stay sync and
 * portable. Like the Murmur3 bucketing hash, the known-answer tests pin this
 * implementation to the reference vectors. contentHash is a permanent contract
 * (it addresses stored versions and pins in-flight journeys), so the algorithm
 * must never change once production data exists.
 */

// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

const utf8 = new TextEncoder();

/** SHA-256 over the UTF-8 bytes of `input`, as 64 hex chars. */
export function sha256Hex(input: string): string {
  const data = utf8.encode(input);
  const bitLenLo = (data.length << 3) >>> 0;
  const bitLenHi = Math.floor(data.length / 0x20000000);

  // Pad to a multiple of 64 bytes: 0x80, zeros, then the 64-bit big-endian bit length
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLenHi);
  view.setUint32(padded.length - 4, bitLenLo);

  // prettier-ignore
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
}

/**
 * Truncate to 128 bits (32 hex chars): collision-safe for content addressing at
 * any realistic definition count, and short enough for KV keys and instance ids.
 */
const contentHashOf = (input: string): string => sha256Hex(input).slice(0, 32);

/** Content hash of execution semantics (strip metadata → canonical JSON → truncated SHA-256). */
export function semanticHash(value: unknown): string {
  return contentHashOf(canonicalJSON(stripMeta(value)));
}

/** Canonical hash of the full content — used to tell "semantics unchanged, metadata edited" apart. */
export function fullHash(value: unknown): string {
  return contentHashOf(canonicalJSON(value));
}
