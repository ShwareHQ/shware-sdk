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

/** Validates with the schema; a violation is an `INVALID_ARGUMENT` listing every field. */
async function check<S extends ZodType | ZodMiniType>(schema: S, value: unknown) {
  const result = await schema.safeParseAsync(value);
  if (result.success) return result.data as S extends ZodType ? outputV4<S> : outputMini<S>;

  const fieldViolations: BadRequest['fieldViolations'] = result.error.issues.map(
    ({ code, path, message }) => ({
      field: path.join('.'),
      description: message,
      reason: code.toUpperCase(),
      localizedMessage: { locale: 'en-US', message },
    })
  );
  const details = Details.new().badRequest({ fieldViolations });
  throw Status.invalidArgument().error(details);
}

export function zValidator<S extends ZodType | ZodMiniType>(
  target: keyof ValidationTargets,
  schema: S
) {
  return validator(target, (value) => check(schema, value));
}

const TEXT_PLAIN = /^text\/plain\b/i;

/**
 * A JSON body that may also arrive as `text/plain`, validated as `json`: what a browser sends with
 * `navigator.sendBeacon` to stay a CORS simple request. As `application/json` a cross-origin
 * beacon needs a preflight, which a page being closed often cannot complete, and the beacon is
 * then dropped — exactly the one sent as the visitor leaves. Hono's `json` target reads any
 * content type but JSON as `{}`, so the text is parsed here. Anything else is read as before.
 *
 * Use it on the routes a beacon is sent to, and only there: it widens what a cross-site page can
 * post without a preflight, which is harmless for an endpoint that takes no credentials.
 */
export function zBeaconJson<S extends ZodType | ZodMiniType>(schema: S) {
  return validator('json', async (value, c) => {
    if (!TEXT_PLAIN.test(c.req.header('Content-Type') ?? '')) return check(schema, value);
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      throw Status.invalidArgument('Malformed JSON in request body').error();
    }
    return check(schema, body);
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
