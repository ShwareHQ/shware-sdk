/**
 * Cohort bucketing — deterministic assignment of a user to an A/B arm.
 *
 * MurmurHash3 (x86, 32-bit, seed 0) over the UTF-8 bytes of the key, the same
 * construction A/B systems like Unleash use: excellent avalanche behaviour
 * (sequential user ids spread evenly, where FNV-1a showed low-bit bias) and a
 * frozen, widely cross-checked algorithm. Hand-written on purpose: the engine
 * core stays dependency-free, and the known-answer tests pin this
 * implementation against the reference vectors — a stronger guarantee than
 * trusting an npm package's variant.
 *
 * The bucket function is a permanent contract: changing it reshuffles every
 * in-flight cohort, so it must never change once production traffic exists.
 */

/** MurmurHash3 x86 32-bit over raw bytes; seed 0. Returns an unsigned 32-bit integer. */
export function murmur3(bytes: Uint8Array, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;

  const tail = bytes.length & ~3;
  for (let i = 0; i < tail; i += 4) {
    let k = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }

  let k = 0;
  const remainder = bytes.length & 3;
  if (remainder === 3) k ^= bytes[tail + 2] << 16;
  if (remainder >= 2) k ^= bytes[tail + 1] << 8;
  if (remainder >= 1) {
    k ^= bytes[tail];
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
  }

  h ^= bytes.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const utf8 = new TextEncoder();

/**
 * Bucket resolution: basis points, i.e. hundredths of a percent. Weights are
 * compared on the same integer grid (weight% × 100), so fractional splits like
 * 33.3/33.3/33.4 are honoured exactly and the whole path stays float-free —
 * the Optimizely/Statsig construction.
 */
export const BUCKET_RESOLUTION = 10_000;

/**
 * Map a bucketing key (`${userId}:${cohortKey}`) to [0, 10000). Keys hash
 * their UTF-8 bytes, so results agree with any standard Murmur3 implementation
 * regardless of the user id's alphabet.
 */
export function hashToBucket(input: string): number {
  return murmur3(utf8.encode(input)) % BUCKET_RESOLUTION;
}
