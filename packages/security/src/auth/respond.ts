import { OAuth2Error, type OAuth2ErrorType } from '../oauth2/error';
import { AuthenticationError } from './error';

/**
 * How the JSON routes answer a failure: a google.rpc error body, as `@shware/http` reads it, with
 * one `ErrorInfo` whose `reason` the client branches on. The redirect flow answers differently
 * (`error=…` on `errorUri`, see `Auth.redirect`), since a page, not a client, reads it.
 */
export interface ErrorBody {
  error: {
    code: number;
    status: string;
    message: string;
    details: unknown[];
  };
}

const ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo';

export function errorBody(
  code: number,
  status: string,
  reason: string,
  message: string,
  metadata?: Record<string, string>
): ErrorBody {
  const info = { '@type': ERROR_INFO, reason, ...(metadata ? { metadata } : {}) };
  return { error: { code, status, message, details: [info] } };
}

/**
 * A request a route cannot act on, answered as it is: malformed, too soon, not signed in. Thrown
 * by the validation helpers so a route reads as one straight line; `errorResponse` turns it into
 * the response. Unlike `AuthenticationError`, which is about who is signing in, this is about
 * the request itself, so it is not the host's to throw.
 */
export class RequestError extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(body.error.message);
    this.name = 'RequestError';
    this.body = body;
    Object.setPrototypeOf(this, RequestError.prototype);
  }
}

export function invalidArgument(reason: string, message: string, details?: unknown[]) {
  const body = errorBody(400, 'INVALID_ARGUMENT', reason, message);
  if (details) body.error.details = details;
  return new RequestError(body);
}

export function unauthenticated(message: string) {
  return new RequestError(errorBody(401, 'UNAUTHENTICATED', 'UNAUTHENTICATED', message));
}

export function resourceExhausted(reason: string, message: string) {
  return new RequestError(errorBody(429, 'RESOURCE_EXHAUSTED', reason, message));
}

export function unavailable(reason: string, message: string) {
  return new RequestError(errorBody(503, 'UNAVAILABLE', reason, message));
}

/**
 * What an `OAuth2Error` from the provider client means to the caller of a JSON route: the request
 * named something that does not exist (400), the credential it sent was refused (403), or the
 * provider is down (503). Its message stays in the logs: it can name a client id or quote the
 * provider's response.
 */
const OAUTH2_STATUS: Record<OAuth2ErrorType, [code: number, status: string]> = {
  invalid_request: [400, 'INVALID_ARGUMENT'],
  invalid_scope: [400, 'INVALID_ARGUMENT'],
  unsupported_grant_type: [400, 'INVALID_ARGUMENT'],
  unsupported_response_type: [400, 'INVALID_ARGUMENT'],
  redirect_uri_mismatch: [400, 'INVALID_ARGUMENT'],
  invalid_client: [403, 'PERMISSION_DENIED'],
  invalid_grant: [403, 'PERMISSION_DENIED'],
  invalid_token: [403, 'PERMISSION_DENIED'],
  unauthorized_client: [403, 'PERMISSION_DENIED'],
  insufficient_scope: [403, 'PERMISSION_DENIED'],
  access_denied: [403, 'PERMISSION_DENIED'],
  server_error: [503, 'UNAVAILABLE'],
  temporarily_unavailable: [503, 'UNAVAILABLE'],
};

/**
 * The response a JSON route gives for an error it knows, or `null` for one it does not, which is
 * the host's (a 500). Every JSON route runs under this, so the three kinds of failure have one
 * mapping: a `RequestError` as it is, an `AuthenticationError` as `403 PERMISSION_DENIED` with the
 * reason and metadata (the host's refusal or the SDK's own: a wrong code, a replayed nonce), an
 * `OAuth2Error` by what it means (`OAUTH2_<error>` as the reason). Exported for the host's error
 * handler, so a flow of its own that calls `Auth` directly (`verifyEmailCode`) answers the same way:
 * `errorResponse(error) ?? yourHandler(error)`.
 */
export function errorResponse(error: unknown): Response | null {
  if (error instanceof RequestError) return json(error.body);
  if (error instanceof AuthenticationError) {
    const body = errorBody(403, 'PERMISSION_DENIED', error.reason, error.message, error.metadata);
    return json(body);
  }
  if (error instanceof OAuth2Error) {
    console.warn('OAuth2 login failed', error);
    const [code, status] = OAUTH2_STATUS[error.error] ?? [503, 'UNAVAILABLE'];
    const reason = `OAUTH2_${error.error.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    return json(errorBody(code, status, reason, `OAuth2 ${error.error}`));
  }
  return null;
}

function json(body: ErrorBody) {
  return Response.json(body, { status: body.error.code });
}
