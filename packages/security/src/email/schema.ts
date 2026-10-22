import { email, maxLength, object, pipe, regex, string, toLowerCase, trim } from 'zod/mini';
import { attributesSchema } from '../auth/attributes';

/**
 * An email address as an identity key: trimmed and lowercased before the format check, so
 * `" A@X.com "` is accepted as `"a@x.com"`. The whole address is lowercased, local part included:
 * RFC 5321 lets a local part be case-sensitive, but practically no provider treats it so, and
 * keeping case would give one mailbox several verification codes, cooldowns and accounts.
 */
const emailSchema = pipe(string().check(trim(), toLowerCase()), email().check(maxLength(320)));

export const sendEmailVerificationCodeSchema = object({
  email: emailSchema,
  turnstileToken: string().check(maxLength(2048)),
});

export const loginEmailSchema = object({
  email: emailSchema,
  verificationCode: string().check(regex(/^\d{6}$/)),
  attributes: attributesSchema,
});
