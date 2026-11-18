import type { ZodType, output } from 'zod';
import type { ZodMiniType, output as outputMini } from 'zod/mini';
import { invalidArgument } from '../auth/respond';

type Output<S extends ZodType | ZodMiniType> = S extends ZodType ? output<S> : outputMini<S>;

/** The body as JSON, or a 400 for one that is not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidArgument('INVALID_JSON', 'Request body is not valid JSON');
  }
}

/** The body as a form, or a 400 for one that is not `application/x-www-form-urlencoded`. */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw invalidArgument('INVALID_CONTENT_TYPE', 'Expected application/x-www-form-urlencoded');
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

/** `value` as `schema` reads it, or a 400 `BadRequest` naming each field that failed. */
export function parse<S extends ZodType | ZodMiniType>(schema: S, value: unknown): Output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as Output<S>;
  const fieldViolations = result.error.issues.map(({ code, path, message }) => ({
    field: path.join('.'),
    description: message,
    reason: code.toUpperCase(),
    localizedMessage: { locale: 'en-US', message },
  }));
  throw invalidArgument('INVALID_ARGUMENT', 'Invalid request', [
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations },
  ]);
}
