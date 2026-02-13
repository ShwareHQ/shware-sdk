import type { ZodType, output } from 'zod';
import type { ZodMiniType, output as outputMini } from 'zod/mini';

type ErrorBody = {
  error: {
    code: number;
    status: string;
    message: string;
    details: unknown[];
  };
};

export function invalidArgument(reason: string): ErrorBody {
  return {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: 'Invalid verification code',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }],
    },
  };
}

type Result<S extends ZodType | ZodMiniType> =
  | { error: null; data: S extends ZodType ? output<S> : outputMini<S> }
  | { error: ErrorBody; data: null };

export function valid<S extends ZodType | ZodMiniType>(schema: S, json: unknown): Result<S> {
  const result = schema.safeParse(json);
  if (result.success) {
    return {
      error: null,
      data: result.data as S extends ZodType ? output<S> : outputMini<S>,
    };
  }

  const fieldViolations = result.error.issues.map(({ code, path, message }) => ({
    field: path.join('.'),
    description: message,
    reason: code?.toUpperCase() ?? 'INVALID_ARGUMENT',
    localizedMessage: { locale: 'en-US', message: message },
  }));

  const error = {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: 'Invalid request',
      details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations }],
    },
  };

  return { error, data: null };
}

export async function verifyTurnstileToken(secret: string, token: string) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  });

  const data = (await response.json()) as { success: boolean };
  if (data.success) return { error: null };
  return { error: invalidArgument('TURNSTILE_VERIFICATION_FAILED') };
}
