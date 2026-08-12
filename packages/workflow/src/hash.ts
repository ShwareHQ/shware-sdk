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

/** Stable content hash. FNV-1a 64 for now (sync, zero deps); swap for truncated SHA-256 in production. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Content hash of execution semantics (strip metadata → canonical JSON → FNV-1a 64). */
export function semanticHash(value: unknown): string {
  return fnv1a64(canonicalJSON(stripMeta(value)));
}

/** Canonical hash of the full content — used to tell "semantics unchanged, metadata edited" apart. */
export function fullHash(value: unknown): string {
  return fnv1a64(canonicalJSON(value));
}
