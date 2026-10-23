/**
 * Helpers for Stripe's expandable fields: a reference Stripe returns as a bare id, or as the whole
 * object when the request asked for it with `expand`.
 */

type Ref<T extends { id: string }> = string | T | null | undefined;

/** The id behind an expandable field, whether it came back expanded or not. */
export function idOf<T extends { id: string }>(ref: string | T): string;
export function idOf<T extends { id: string }>(ref: Ref<T>): string | null;
export function idOf<T extends { id: string }>(ref: Ref<T>): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * The object behind an expandable field the caller retrieved with `expand`. A bare id means the
 * request forgot the expansion, a bug in the caller rather than anything Stripe can fix on a retry,
 * so it throws; an absent reference stays null. `what` names the field for the error message.
 */
export function expanded<T extends { id: string }>(ref: string | T, what: string): T;
export function expanded<T extends { id: string }>(ref: Ref<T>, what: string): T | null;
export function expanded<T extends { id: string }>(ref: Ref<T>, what: string): T | null {
  if (!ref) return null;
  if (typeof ref === 'string') throw new Error(`${what} ${ref} was retrieved without expanding it`);
  return ref;
}
