import { optional, record, refine, string } from 'zod/mini';
import { invalidArgument } from './respond';

/** Upper bound on serialized attributes: they ride in a session or a request body. */
export const MAX_ATTRIBUTES_BYTES = 2048;

export function attributesSize(attributes: Record<string, string>) {
  return new TextEncoder().encode(JSON.stringify(attributes)).length;
}

/**
 * The optional `attributes` field of a login body (native, One Tap, email): string values only,
 * at most `MAX_ATTRIBUTES_BYTES` serialized. Sent by the client itself, so a bad one is the
 * client's error (400), unlike oversized attributes passed to `oauth2Authorization` by the host.
 */
export const attributesSchema = optional(
  record(string(), string()).check(
    refine((value) => attributesSize(value) <= MAX_ATTRIBUTES_BYTES, {
      message: `attributes must be at most ${MAX_ATTRIBUTES_BYTES} bytes`,
    })
  )
);

/**
 * The optional `attributes` of a login body (native): `{}` when absent, a 400 when present but
 * not strings-to-strings within `MAX_ATTRIBUTES_BYTES`.
 */
export function bodyAttributes(body: unknown): Record<string, string> {
  const value =
    typeof body === 'object' && body !== null && 'attributes' in body ? body.attributes : undefined;
  const parsed = attributesSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidArgument(
      'INVALID_ATTRIBUTES',
      `attributes must map strings to strings, at most ${MAX_ATTRIBUTES_BYTES} bytes`
    );
  }
  return parsed.data ?? {};
}
