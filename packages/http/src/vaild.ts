import type { z, ZodType } from 'zod/v4';
import { Details } from './detail';
import { BadRequest } from './detail';
import { Status } from './status';

export type Result<S extends ZodType> =
  | { data: z.infer<S>; error: null }
  | { data: null; error: Response };

type Target = 'json' | 'form' | 'query' | 'param' | 'header' | 'cookie';

async function getTarget(request: Request, target: Target): Promise<any> {
  switch (target) {
    case 'json':
      return request.json();
    default:
      throw new Error(`Unsupported target: ${target}`);
  }
}

export async function valid<S extends ZodType>(
  request: Request,
  target: Target,
  schema: S
): Promise<Result<S>> {
  const value = await getTarget(request, target);
  const validator = await schema.safeParseAsync(value);
  if (validator.success) return { data: validator.data, error: null };
  const fieldViolations: BadRequest['fieldViolations'] = validator.error.issues.map(
    ({ path, message }) => ({ field: path.join('.'), description: message })
  );
  const details = Details.new().badRequest({ fieldViolations });
  const error = Status.invalidArgument().response(details);
  return { data: null, error };
}
