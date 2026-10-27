// reference: https://datatracker.ietf.org/doc/html/rfc6749#section-4.2.2.1
export type OAuth2ErrorType =
  | 'invalid_request' // 400
  | 'invalid_client' // 401
  | 'invalid_grant' // 400
  | 'invalid_token' // 401
  | 'invalid_scope' // 400
  | 'unauthorized_client' // 401
  | 'unsupported_grant_type' // 400
  | 'unsupported_response_type' // 400
  | 'insufficient_scope' // 403
  | 'redirect_uri_mismatch' // 400
  | 'access_denied' // 400
  | 'server_error' // 500
  | 'temporarily_unavailable' // 503
  | (string & {});

/** The registered error codes of `OAuth2ErrorType`, for checking untrusted input at runtime. */
const OAUTH2_ERROR_TYPES: ReadonlySet<string> = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'invalid_token',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'insufficient_scope',
  'redirect_uri_mismatch',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);

export function isKnownOAuth2ErrorType(value: string): boolean {
  return OAUTH2_ERROR_TYPES.has(value);
}

export class OAuth2Error extends Error {
  readonly status: number;
  readonly error: OAuth2ErrorType;

  constructor(status: number, error: OAuth2ErrorType, message?: string) {
    super(message ?? `OAuth2 error: ${error}`);
    this.status = status;
    this.error = error;
    Object.setPrototypeOf(this, OAuth2Error.prototype);
  }
}

/**
 * A sign-in the host's `onAuthorized` refuses on purpose (an email another account holds, a banned
 * user, ...), as Spring's `OAuth2AuthenticationException`. `reason` is an error code the clients
 * switch on and `metadata` what they need to say it (`{ provider: 'GOOGLE' }`). The SDK answers
 * the JSON login routes with `403` and a google.rpc `ErrorInfo` carrying both, and the redirect
 * flow with `errorUri?error=access_denied&reason=…` plus the metadata entries as parameters.
 * Any other error a handler throws is the app's problem: `500` / `server_error`, details in logs.
 */
export class AuthenticationError extends Error {
  constructor(
    readonly reason: string,
    readonly metadata?: Record<string, string>,
    message?: string
  ) {
    super(message ?? `Authentication refused: ${reason}`);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}
