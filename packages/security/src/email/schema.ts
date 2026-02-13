import { email, maxLength, object, regex, string } from 'zod/mini';

export const sendEmailVerificationCodeSchema = object({
  email: email().check(maxLength(320)),
  turnstileToken: string().check(maxLength(2048)),
});

export const loginEmailSchema = object({
  email: email().check(maxLength(320)),
  verificationCode: string().check(regex(/^\d{6}$/)),
});
