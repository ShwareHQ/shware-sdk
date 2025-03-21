import type { z, ZodSchema } from 'zod';
import type { ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import { Status } from '../status';
import { Details } from '../detail';
import type { BadRequest } from '../detail';

export function zValidator<S extends ZodSchema>(target: keyof ValidationTargets, schema: S) {
  return validator(target, async (value) => {
    const result = await schema.safeParseAsync(value);
    if (result.success) return result.data as z.infer<S>;

    const fieldViolations: BadRequest['fieldViolations'] = result.error.issues.map(
      ({ path, message }) => ({ field: path.join('.'), description: message })
    );
    const details = Details.new().badRequest({ fieldViolations });
    throw Status.invalidArgument().error(details);
  });
}
