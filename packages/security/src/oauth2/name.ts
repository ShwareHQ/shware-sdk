import type { PersonNameComponents, StandardClaims } from './types';

/**
 * Upper bound, in characters, on each name part taken from the client. Names that reach us outside
 * a signed token (Apple's form_post `user`, a native login body) are plain client input, so they
 * are capped before a host stores them; 64 leaves room for any real given or family name.
 */
export const MAX_NAME_PART_LENGTH = 64;

/** Apple's form_post `user` is a few dozen bytes; anything far larger is not Apple's. */
const MAX_APPLE_USER_LENGTH = 1024;

const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

/**
 * Composes a display `name` from its parts, for providers that hand out the parts only. Chinese,
 * Japanese and Korean names are written family name first without a space (`王小明`), every other
 * name given name first (`John Appleseed`), which is also the safe choice for mixed scripts. With
 * one part only, that part is the name.
 */
export function composeName({
  given_name,
  family_name,
}: Pick<StandardClaims, 'given_name' | 'family_name'>): string | undefined {
  const given = given_name?.trim();
  const family = family_name?.trim();
  if (given && family) {
    return CJK.test(given) && CJK.test(family) ? `${family}${given}` : `${given} ${family}`;
  }
  return given || family || undefined;
}

/**
 * One untrusted name part: a non-blank string, trimmed and capped at `MAX_NAME_PART_LENGTH`
 * characters (code points, so a cut never splits one). Anything else is dropped rather than refused,
 * because the name is a nicety and must never cost the user their login.
 */
export function cleanNamePart(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed).slice(0, MAX_NAME_PART_LENGTH).join('');
}

/** Name parts as Apple's form_post `user` carries them, after cleaning. */
export interface AppleUser {
  name?: { firstName?: string; lastName?: string };
  email?: string;
}

/**
 * Parses Apple's form_post `user` (JSON, first authorization only). Malformed JSON or a wrong shape
 * yields `undefined`, never an error. Only known fields are kept, each cleaned, so what a host
 * persists stays small.
 */
export function parseAppleUser(raw: string | undefined): AppleUser | undefined {
  if (!raw || raw.length > MAX_APPLE_USER_LENGTH) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(json)) return undefined;
  const user: AppleUser = {};
  if (isObject(json.name)) {
    const firstName = cleanNamePart(json.name.firstName);
    const lastName = cleanNamePart(json.name.lastName);
    if (firstName || lastName) user.name = withoutUndefined({ firstName, lastName });
  }
  // Kept as Apple sent it for the record only: the id token's email is signed, this one is not.
  const email = typeof json.email === 'string' ? json.email.trim().slice(0, 320) : undefined;
  if (email) user.email = email;
  return user.name || user.email ? user : undefined;
}

const PERSON_NAME_KEYS = [
  'givenName',
  'familyName',
  'middleName',
  'namePrefix',
  'nameSuffix',
  'nickname',
] as const satisfies (keyof PersonNameComponents)[];

/**
 * Cleans the `full_name` of a native login body (iOS `PersonNameComponents`): known keys only,
 * each a cleaned string; `undefined` when nothing usable is left.
 */
export function cleanPersonName(value: unknown): PersonNameComponents | undefined {
  if (!isObject(value)) return undefined;
  const name: PersonNameComponents = {};
  for (const key of PERSON_NAME_KEYS) {
    const part = cleanNamePart(value[key]);
    if (part) name[key] = part;
  }
  return Object.keys(name).length > 0 ? name : undefined;
}

type NameClaims = Pick<
  StandardClaims,
  'name' | 'given_name' | 'family_name' | 'middle_name' | 'nickname'
>;

/**
 * The standard name claims from cleaned parts, with `name` composed from given and family name.
 * Undefined parts are left out, so spreading the result never overwrites a claim with `undefined`.
 */
export function nameClaims(parts: Omit<NameClaims, 'name'>): NameClaims {
  return withoutUndefined({ ...parts, name: composeName(parts) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
