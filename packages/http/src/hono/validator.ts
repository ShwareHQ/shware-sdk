import type { ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import type { ZodType, output as outputV4 } from 'zod';
import {
  NEVER,
  type ZodMiniType,
  type output as outputMini,
  pipe,
  string,
  transform,
} from 'zod/mini';
import { type BadRequest, Details } from '../error/detail';
import { Status } from '../error/status';

export function zValidator<S extends ZodType | ZodMiniType>(
  target: keyof ValidationTargets,
  schema: S
) {
  return validator(target, async (value) => {
    const result = await schema.safeParseAsync(value);
    if (result.success) return result.data as S extends ZodType ? outputV4<S> : outputMini<S>;

    const fieldViolations: BadRequest['fieldViolations'] = result.error.issues.map(
      ({ code, path, message }) => ({
        field: path.join('.'),
        description: message,
        reason: code?.toUpperCase() ?? 'INVALID_ARGUMENT',
        localizedMessage: { locale: 'en-US', message: message },
      })
    );
    const details = Details.new().badRequest({ fieldViolations });
    throw Status.invalidArgument().error(details);
  });
}

export const bigintId = pipe(
  string(),
  transform((input, ctx) => {
    if (!/^(0|[1-9]\d{0,19})$/.test(input)) {
      const message = `Invalid bigint id: ${input}`;
      ctx.issues.push({ code: 'custom', input, message });
      return NEVER;
    }
    try {
      return BigInt(input);
    } catch {
      const message = `Parse bigint id: ${input} failed`;
      ctx.issues.push({ code: 'custom', input, message });
      return NEVER;
    }
  })
);
