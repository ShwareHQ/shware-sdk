import { validator } from 'hono/validator';
import { transform, pipe, string, NEVER } from 'zod/v4-mini';
import { Details } from '../error/detail';
import { Status } from '../error/status';
import type { BadRequest } from '../error/detail';
import type { ValidationTargets } from 'hono';
import type { output as outputV4, ZodType } from 'zod/v4';
import type { output as outputMini, ZodMiniType } from 'zod/v4-mini';

export function zValidator<S extends ZodType | ZodMiniType>(
  target: keyof ValidationTargets,
  schema: S
) {
  return validator(target, async (value) => {
    const result = await schema.safeParseAsync(value);
    if (result.success) return result.data as S extends ZodType ? outputV4<S> : outputMini<S>;

    const fieldViolations: BadRequest['fieldViolations'] = result.error.issues.map(
      ({ path, message }) => ({ field: path.join('.'), description: message })
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
    } catch (_) {
      const message = `Parse bigint id: ${input} failed`;
      ctx.issues.push({ code: 'custom', input, message });
      return NEVER;
    }
  })
);
