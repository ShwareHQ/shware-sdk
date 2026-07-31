import { hasText } from '@shware/utils';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { RequestIdVariables } from 'hono/request-id';
import type { Bindings, HTTPResponseError } from 'hono/types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Details } from '../error/detail';
import { Code, Status, StatusCode, StatusError } from '../error/status';

export type Env = {
  Variables: RequestIdVariables;
  Bindings?: Bindings;
};

type AxiosError = {
  code?: string;
  cause?: unknown;
  status?: number;
  message?: string;
  isAxiosError: boolean;
  response?: {
    data: unknown;
    status: number;
    statusText: string;
    headers: Record<string, string>;
  };
  config?: { url?: string; data?: unknown; method?: string; headers?: Record<string, string> };
};

/**
 * `Code` maps a name to an HTTP status, and that mapping is not injective: 400 is INVALID_ARGUMENT,
 * FAILED_PRECONDITION and OUT_OF_RANGE alike. Reversing it therefore needs a tiebreaker for the
 * statuses several codes share — the rest is derived, so new entries in `Code` come along for free.
 */
const CANONICAL_CODE: Record<number, keyof typeof Code> = {
  400: 'INVALID_ARGUMENT',
  409: 'ALREADY_EXISTS',
  500: 'INTERNAL',
};

const CODE_BY_HTTP_STATUS: Record<number, keyof typeof Code> = {
  ...Object.fromEntries(Object.entries(Code).map(([name, status]) => [status, name])),
  ...CANONICAL_CODE,
};

/** Canonical code for errors that only carry an HTTP status, such as hono's `HTTPException`. */
function toStatusCode(status: number, message?: string): StatusCode {
  const code = CODE_BY_HTTP_STATUS[status] ?? (status < 500 ? 'INVALID_ARGUMENT' : 'INTERNAL');
  return StatusCode.of(code, hasText(message) ? message : undefined);
}

function summarize(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function isAxiosError(payload: unknown): payload is AxiosError {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'isAxiosError' in payload &&
    payload.isAxiosError === true
  );
}

/**
 * `instanceof` alone is not enough: two copies of this package (duplicated in a lockfile, or one
 * bundled into a dependency) produce distinct classes, and `Status.adapter` may swap in a
 * host-defined error class entirely. Fall back to recognizing the error by shape.
 */
export function isStatusError(payload: unknown): payload is StatusError {
  if (payload instanceof StatusError) return true;
  if (payload === null || typeof payload !== 'object') return false;
  const { status, body } = payload as { status?: unknown; body?: { error?: { code?: unknown } } };
  return typeof status === 'number' && typeof body?.error?.code === 'number';
}

export function errorHandler<E extends Env = never>(
  error: Error | HTTPResponseError,
  c: Context<E>
): Response | Promise<Response> {
  const requestId = c.get('requestId');
  const servingData = `${c.req.method}: ${c.req.path}`;
  const details = Details.new().requestInfo({ requestId, servingData });

  if (isStatusError(error)) {
    const body = error.body ?? Status.internal().body();
    body.error.details.push(...details.list);
    // Only 5xx is a server fault; logging expected 4xx at error level drowns out the real ones.
    // Field violations travel inside `details`, so one line carries the whole error.
    const log = error.status >= 500 ? console.error : console.warn;
    log(servingData, JSON.stringify(body.error));
    return c.json(body, error.status as ContentfulStatusCode);
  }

  // The client vanished mid-request: tab closed, navigation, or an aborted fetch. Whatever we
  // return is discarded, and nothing failed on our side, so keep it to one terse line. Shows up
  // in local dev because the request body is streamed straight off the socket — a truncated body
  // fails to parse; platforms that buffer the whole request before invoking (API Gateway, Lambda
  // function URLs) never hand us a partial request in the first place.
  if (c.req.raw.signal.aborted) {
    console.warn(`Client closed request: ${servingData}`, summarize(error));
    return Status.cancelled().response(details);
  }

  if (error instanceof HTTPException) {
    // Middleware such as `bearerAuth` attaches a prepared response carrying headers the client
    // needs (`WWW-Authenticate`, …); hand that back untouched instead of re-wrapping it.
    const log = error.status >= 500 ? console.error : console.warn;
    log(`HTTP exception: ${servingData}`, error.status, error.message);
    if (error.res) return error.res;
    return toStatusCode(error.status, error.message).response(details);
  }

  if (isAxiosError(error)) {
    console.error(`Axios error: ${servingData}`, {
      requestId,
      code: error.code,
      status: error.status ?? error.response?.status,
      message: error.message,
      request: {
        method: error.config?.method,
        url: error.config?.url,
        data: error.config?.data,
      },
      response: { data: error.response?.data },
    });
    return Status.internal('Axios error').response(details);
  }

  console.error(`Unknown error: ${servingData}`, requestId, error);
  return Status.internal('Unknown error').response(details);
}
